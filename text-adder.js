const sharp = require("sharp");

/**
 * Adds a title text near the top of an image.
 *
 * @param {string|Buffer} inputImage - Path, URL, or Buffer of the source image.
 * @param {string} text - Title text to overlay.
 * @param {object} [options]
 * @param {string} [options.outputPath] - If provided, writes the result to this path.
 * @param {number} [options.marginRatio=0.06] - Portion of the image height used for top margin.
 * @param {number} [options.fontSizeRatio=0.08] - Font size as fraction of image height.
 * @param {number} [options.strokeWidth=3] - Outline stroke width around text.
 * @param {string} [options.fontFamily="Inter, Segoe UI, Helvetica, Arial, sans-serif"] - CSS font-family.
 * @param {string} [options.fillColor="#ffffff"] - Text fill color.
 * @param {string} [options.strokeColor="rgba(0,0,0,0.65)"] - Text stroke color.
 * @param {number} [options.padding=24] - Horizontal padding from the left/right edges.
 * @returns {Promise<Buffer>} Returns the resulting image buffer.
 */
async function addTitleToImage(inputImage, text, options = {}) {
  if (!inputImage) {
    throw new Error("inputImage is required");
  }

  if (!text || !text.trim()) {
    throw new Error("text must be a non-empty string");
  }

  const {
    outputPath,
    marginRatio = 0.06,
    fontSizeRatio = 0.08,
    strokeWidth = 3,
    fontFamily = "Inter, Segoe UI, Helvetica, Arial, sans-serif",
    fillColor = "#ffffff",
    strokeColor = "rgba(0,0,0,0.65)",
    padding = 24,
  } = options;

  const image = sharp(inputImage);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error("Unable to determine image dimensions");
  }

  const margin = Math.round(metadata.height * marginRatio);
  const fontSize = Math.max(24, Math.round(metadata.height * fontSizeRatio));

  const svg = createTitleSVG({
    width: metadata.width,
    height: metadata.height,
    text,
    margin,
    fontSize,
    strokeWidth,
    fontFamily,
    fillColor,
    strokeColor,
    padding,
  });

  const compositeBuffer = Buffer.from(svg);
  const result = await image
    .composite([{ input: compositeBuffer, top: 0, left: 0 }])
    .toBuffer();

  if (outputPath) {
    await sharp(result).toFile(outputPath);
  }

  return result;
}

function createTitleSVG({
  width,
  height,
  text,
  margin,
  fontSize,
  strokeWidth,
  fontFamily,
  fillColor,
  strokeColor,
  padding,
}) {
  const safeText = escapeXML(text.trim());
  const svg = `
<svg width="${width}" height="${height}">
  <style>
    text {
      font-family: ${fontFamily};
      font-size: ${fontSize}px;
      font-weight: 700;
      fill: ${fillColor};
      paint-order: stroke fill;
      stroke: ${strokeColor};
      stroke-width: ${strokeWidth}px;
    }
  </style>
  <rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />
  <text x="${padding}" y="${margin + fontSize}" text-anchor="start">${safeText}</text>
</svg>`;
  return svg;
}

function escapeXML(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = { addTitleToImage };

if (require.main === module) {
  (async () => {
    const [, , input, ...rest] = process.argv;
    if (!input || rest.length === 0) {
      console.error(
        "Usage: node text-adder.js <inputImage> <text> [--output=output.png]"
      );
      process.exit(1);
    }

    const options = {};
    const textParts = [];

    for (const arg of rest) {
      if (arg.startsWith("--output=")) {
        options.outputPath = arg.slice("--output=".length);
      } else {
        textParts.push(arg);
      }
    }

    const title = textParts.join(" ");

    try {
      await addTitleToImage(input, title, options);
      if (options.outputPath) {
        console.log("Title added and saved to", options.outputPath);
      } else {
        console.log("Title added (result not saved because no output was specified).");
      }
    } catch (error) {
      console.error(error.message || error);
      process.exit(1);
    }
  })();
}

