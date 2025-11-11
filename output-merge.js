const fs = require("fs");
const path = require("path");

async function outputMerge(options = {}) {
  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.resolve(process.cwd(), "generated");
  
  // Default to root directory for merged PDF
  const outputPdfPath = options.outputPath
    ? path.resolve(options.outputPath)
    : path.resolve(process.cwd(), "merged-output.pdf");

  // Check if output directory exists
  if (!fs.existsSync(outputDir)) {
    throw new Error(`Output directory does not exist: ${outputDir}`);
  }

  // Find all image files in the output directory
  const files = await fs.promises.readdir(outputDir);
  const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"];
  
  const imageFiles = files
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return imageExtensions.includes(ext);
    })
    .map((file) => path.join(outputDir, file))
    .sort(); // Sort for consistent ordering

  if (imageFiles.length === 0) {
    throw new Error(`No image files found in output directory: ${outputDir}`);
  }

  console.log(`Found ${imageFiles.length} image file(s) to merge`);

  // Try to use pdf-lib if available, otherwise use sharp's PDF creation
  let pdfBuffer;
  
  try {
    // Try to use pdf-lib for better PDF merging
    const { PDFDocument } = require("pdf-lib");
    const pdfDoc = await PDFDocument.create();

    for (const imagePath of imageFiles) {
      const imageBuffer = await fs.promises.readFile(imagePath);
      const ext = path.extname(imagePath).toLowerCase();
      
      // Embed image based on format
      let image;
      if (ext === ".jpg" || ext === ".jpeg") {
        image = await pdfDoc.embedJpg(imageBuffer);
      } else {
        // Default to PNG for .png, .gif, .bmp, .webp, etc.
        image = await pdfDoc.embedPng(imageBuffer);
      }
      
      // Get image dimensions
      const { width, height } = image.scale(1);
      
      // Create landscape page (11 x 8.5 inches = 792 x 612 points)
      // Standard US Letter landscape: 792 x 612 points
      const landscapeWidth = 792;  // 11 inches
      const landscapeHeight = 612; // 8.5 inches
      const page = pdfDoc.addPage([landscapeWidth, landscapeHeight]);
      
      // Calculate scaling to fit page while maintaining aspect ratio
      const scale = Math.min(landscapeWidth / width, landscapeHeight / height);
      const scaledWidth = width * scale;
      const scaledHeight = height * scale;
      
      // Center the image on the page
      const x = (landscapeWidth - scaledWidth) / 2;
      const y = (landscapeHeight - scaledHeight) / 2;
      
      page.drawImage(image, {
        x,
        y,
        width: scaledWidth,
        height: scaledHeight,
      });
      
      console.log(`Added page: ${path.basename(imagePath)}`);
    }

    pdfBuffer = await pdfDoc.save();
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND" && error.message.includes("pdf-lib")) {
      // Fallback to sharp if pdf-lib is not available
      console.warn("pdf-lib not found, using sharp fallback (single image per PDF, then merging requires pdf-lib)");
      throw new Error(
        "pdf-lib is required for merging images into PDF. Install it with: npm install pdf-lib"
      );
    } else {
      throw error;
    }
  }

  // Write the merged PDF
  await fs.promises.writeFile(outputPdfPath, pdfBuffer);
  console.log(`Merged PDF saved to: ${outputPdfPath}`);

  return {
    outputPath: outputPdfPath,
    imageCount: imageFiles.length,
    imageFiles: imageFiles.map((f) => path.basename(f)),
  };
}

module.exports = { outputMerge };

if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);
    const cliOptions = {};

    for (const arg of argv) {
      if (!arg.startsWith("--")) continue;
      const [flag, value = ""] = arg.slice(2).split("=");
      if (flag === "output") {
        cliOptions.outputPath = value;
      } else if (flag === "output-dir") {
        cliOptions.outputDir = value;
      }
    }

    try {
      const result = await outputMerge(cliOptions);
      console.log(`Successfully merged ${result.imageCount} image(s) into PDF`);
    } catch (error) {
      console.error("Error merging images:", error.message || error);
      process.exitCode = 1;
    }
  })();
}

