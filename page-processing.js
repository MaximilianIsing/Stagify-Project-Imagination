const fs = require("fs");
const path = require("path");
const { describeSpaceFromFloorplan } = require("./describe");
const { generateRoomImage } = require("./generate-room");

async function describePageAndGenerate(imagePaths, options = {}) {
  const inputPaths = Array.isArray(imagePaths) ? imagePaths : [imagePaths];
  if (!inputPaths.length) {
    throw new Error("imagePath is required");
  }

  const resolvedImages = inputPaths.map((p) => path.resolve(p));
  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.resolve(process.cwd(), "generated");
  await fs.promises.mkdir(outputDir, { recursive: true });

  console.log(
    "describePageAndGenerate processing image(s):",
    resolvedImages.join(", ")
  );

  console.log(
    "describePageAndGenerate invoking describeSpaceFromFloorplan with images:",
    resolvedImages
  );
  const descriptionData = await describeSpaceFromFloorplan(resolvedImages, {
    ...(options.describe || {}),
    roomContext: options.roomContext,
  });
  console.log(
    "describePageAndGenerate received description keys:",
    Object.keys(descriptionData || {})
  );
  console.log(
    "GPT narrative preview:",
    descriptionData.narrative ? descriptionData.narrative.slice(0, 400) : ""
  );
  if (descriptionData.geometry) {
    console.log(
      "Geometry JSON preview:",
      JSON.stringify(descriptionData.geometry).slice(0, 400)
    );
  }

  const referenceImages = await Promise.all(
    resolvedImages.map(async (resolved) => {
      const ext = path.extname(resolved).replace(".", "").toLowerCase() || "png";
      const base64 = (await fs.promises.readFile(resolved)).toString("base64");
      console.log(
        "describePageAndGenerate loaded reference image:",
        resolved,
        "size:",
        base64.length
      );
      return {
        path: resolved,
        mimeType: `image/${ext === "jpg" ? "jpeg" : ext}`,
        data: base64,
      };
    })
  );

  const augmentedPrompt = [
    options.roomContext && options.roomContext.roomName
      ? `Room heading: ${options.roomContext.roomName}`
      : "",
    options.roomContext?.headings && options.roomContext.headings.length > 1
      ? [
          "This render must integrate every board page in this set. Summary of page headings:",
          ...options.roomContext.headings.map((heading, index) => {
            const label =
              heading?.rawText ||
              heading?.roomName ||
              `Unlabeled Page ${index + 1}`;
            return `- ${label}`;
          }),
          "Treat each heading above as requirements for the same room—merge them into one cohesive scene."
        ].join("\n")
      : "",
    descriptionData.narrative || descriptionData.raw || "",
    "",
    "STRICT GEOMETRY SPECIFICATION (do not deviate):",
    descriptionData.geometryText ||
      (descriptionData.geometry
        ? JSON.stringify(descriptionData.geometry, null, 2)
        : "No geometry JSON provided."),
    "",
    "Recreate this interior exactly as documented in the board: match the floorplan layout, all referenced furniture and artwork, materials, and the colour palette swatches.",
    "Do not add or remove furniture. The number of chairs, tables, and every other item must match the specification and imagery exactly.",
    "",
    "FURNITURE PLACEMENT AND ORIENTATION:",
    "- You may rotate, reorient, or realign furniture pieces from the reference images to better fit the room layout and create a more natural, cohesive arrangement.",
    "- Furniture can be rotated to any angle that makes sense for the space and improves the overall composition.",
    "- Maintain the same furniture pieces and their relative relationships, but optimize their positioning for the best visual flow and functionality.",
    "- Ensure furniture placement follows the floorplan geometry while allowing for natural adjustments in orientation.",
    "",
    "CRITICAL - DO NOT INCLUDE IN OUTPUT:",
    "- DO NOT render any room name text, labels, or titles anywhere in the image (especially not in the middle top or any corner).",
    "- DO NOT render any floor plans, blueprints, or architectural diagrams anywhere in the image (especially not in the top right corner or any corner).",
    "- DO NOT include any textual annotations, dimension callouts, color palette swatches, or any other design board elements from the reference images.",
    "- DO NOT render any text overlays, captions, watermarks, or labels of any kind.",
    "- The output must be ONLY the interior room scene with furniture, decor, and architectural elements—no design board elements, no text, no floor plans.",
    "",
    "Ignore any textual annotations, dimension callouts, room names, floor plans, blueprints, or design board elements printed on the reference images. These are reference materials only—do not render them in the final scene.",
    "Render a full-width hero shot of the staged room—no white margins, no overlays, no captions, no floor plans, no room names. The camera should show the entire key area, floor to ceiling as appropriate.",
    "",
    "OUTPUT RULES:",
    "- Do not place any textual labels, captions, watermarks, title cards, room names, or floor plans on the image.",
    "- Fill the frame with the interior scene only; avoid black or white borders.",
    "- Ensure framing shows the complete staging: floor, wall, ceiling context, and all furniture/fixtures described.",
    "- Present the view as a realistic 3D render matching the board's specified camera angle.",
    "- The final image must be a clean interior rendering with no design board artifacts, text, or floor plans visible.",
    referenceImages.length > 1
      ? `Multiple board pages are attached (${referenceImages.length}). Integrate every reference image listed here: ${referenceImages
          .map((ref) => path.basename(ref.path))
          .join(", ")}`
      : "",
  ].join("\n");
  console.log(
    "describePageAndGenerate augmented prompt preview:",
    augmentedPrompt.slice(0, 400)
  );

  const { outputPath } = await generateRoomImage(augmentedPrompt, {
    outputPath: path.join(
      outputDir,
      `${path.parse(resolvedImages[0]).name}${
        referenceImages.length > 1 ? "-group" : ""
      }-render.png`
    ),
    keyFile: options.geminiKeyFile || path.resolve("key.txt"),
    referenceImages: referenceImages.map((ref) => ({
      mimeType: ref.mimeType,
      data: ref.data,
    })),
  });

  console.log("Render saved to:", outputPath);

  console.log(
    "describePageAndGenerate completed. Returning description keys:",
    Object.keys(descriptionData || {}),
    "renderPath:",
    outputPath
  );

  return { description: descriptionData, renderPath: outputPath };
}

module.exports = { describePageAndGenerate };

if (require.main === module) {
  (async () => {
    const imagePath = process.argv[2];
    if (!imagePath) {
      console.error("Usage: node page-processing.js <imagePath> [outputDir]");
      process.exit(1);
    }

    const outputDir = process.argv[3];

    try {
      const result = await describePageAndGenerate(imagePath, { outputDir });
      console.log("Description narrative:\n", result.description.narrative || result.description.raw);
      if (result.description.geometry) {
        console.log(
          "Description geometry JSON:\n",
          JSON.stringify(result.description.geometry, null, 2)
        );
      }
      console.log("Generated render:", result.renderPath);
    } catch (error) {
      console.error(error.message || error);
      process.exitCode = 1;
    }
  })();
}

