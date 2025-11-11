const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const Tesseract = require("tesseract.js");

/**
 * Identify the room name from the heading text at the top of a board page using OCR.
 *
 * @param {string} imagePath - Path to the PNG/JPEG page image.
 * @param {object} [options]
 * @param {number} [options.topCropRatio=0.1] - Portion of the image height (0-1) to crop from the top.
 * @param {number} [options.innerBandRatio=0.2] - Portion of the top band height to keep (center slice).
 * @param {number} [options.innerWidthRatio=0.2] - Portion of the image width to keep, centered horizontally.
 * @param {string} [options.language="eng"] - Tesseract language code.
 * @param {number} [options.minConfidence=45] - Minimum confidence for an OCR line to be considered.
 * @param {boolean} [options.clean=true] - Whether to normalize and clean the detected room heading.
 * @param {object} [options.tesseractOptions] - Additional options passed to Tesseract.recognize.
 * @param {boolean} [options.previewCrop=true] - Whether to write the cropped region to disk for inspection.
 * @param {string} [options.previewCropDir] - Directory to place debug crop images (defaults to source image directory).
 * @param {string|false} [options.debugOutput] - Explicit path for the debug crop (false to disable writing).
 * @returns {Promise<{ roomName: string|null, rawText: string|null, confidence: number }>}
 */
async function identifyRoomName(imagePath, options = {}) {
  if (!imagePath) {
    throw new Error("imagePath is required");
  }

  const resolvedPath = path.resolve(imagePath);
  console.log(
    `[identify-room] Starting OCR heading detection for ${resolvedPath} with options:`,
    JSON.stringify(options)
  );
  await assertFileReadable(resolvedPath);

  const {
    topCropRatio = 0.1,
    innerBandRatio = 1.0,
    innerWidthRatio = 0.25,
    language = "eng",
    minConfidence = 45,
    clean = true,
    tesseractOptions = {},
    debugOutput,
    previewCrop = false,
    previewCropDir,
  } = options;

  if (topCropRatio <= 0) {
    throw new Error("topCropRatio must be greater than 0.");
  }

  const effectiveTopCropRatio = Math.min(topCropRatio, 0.1);
  if (effectiveTopCropRatio !== topCropRatio) {
    console.log(
      `[identify-room] Requested topCropRatio ${topCropRatio}, clamped to ${effectiveTopCropRatio} (10% max).`
    );
  }

  if (innerBandRatio <= 0 || innerBandRatio > 1) {
    throw new Error("innerBandRatio must be between 0 and 1.");
  }

  if (innerWidthRatio <= 0 || innerWidthRatio > 1) {
    throw new Error("innerWidthRatio must be between 0 and 1.");
  }

  console.log(
    `[identify-room] Cropping top ${Math.round(
      effectiveTopCropRatio * 100
    )}% of the image and extracting middle ${Math.round(
      innerBandRatio * 100
    )}% of that band height and middle ${Math.round(innerWidthRatio * 100)}% of the width.`
  );
  let previewOutputPath = null;
  if (debugOutput === false) {
    previewOutputPath = null;
  } else if (typeof debugOutput === "string" && debugOutput.trim()) {
    previewOutputPath = path.resolve(debugOutput);
  } else if (previewCropDir) {
    previewOutputPath = path.resolve(
      previewCropDir,
      `${path.parse(resolvedPath).name}-crop.png`
    );
  } else if (previewCrop) {
    previewOutputPath = path.resolve(
      path.dirname(resolvedPath),
      `${path.parse(resolvedPath).name}-crop.png`
    );
  }

  const cropDebugSettings = { outputPath: previewOutputPath };

  const topRegionBuffer = await cropTopRegion(
    resolvedPath,
    effectiveTopCropRatio,
    innerBandRatio,
    innerWidthRatio,
    cropDebugSettings
  );
  console.log(
    `[identify-room] Cropped region buffer length: ${topRegionBuffer.length}`
  );
  if (cropDebugSettings.previewPath) {
    console.log(
      `[identify-room] Crop preview saved to ${cropDebugSettings.previewPath}`
    );
  }

  console.log(
    `[identify-room] Running Tesseract OCR (language=${language}, minConfidence=${minConfidence})`
  );
  const result = await Tesseract.recognize(
    topRegionBuffer,
    language,
    tesseractOptions
  );

  const lines = Array.isArray(result?.data?.lines) ? result.data.lines : [];
  const eligibleLines = lines.filter(
    (line) => (line.confidence ?? 0) >= minConfidence
  );

  const uppercaseCandidates = eligibleLines.filter((line) =>
    looksLikeAllCaps(line.text)
  );
  const rankedLines = (uppercaseCandidates.length > 0
    ? uppercaseCandidates
    : eligibleLines
  ).sort((a, b) => {
    const confDelta = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (Math.abs(confDelta) > 0.1) return confDelta;
    return (b.text?.length ?? 0) - (a.text?.length ?? 0);
  });

  const bestLine = rankedLines[0] || null;
  console.log(
    "[identify-room] OCR lines:",
    lines.map((line) => ({
      text: line.text?.trim(),
      confidence: line.confidence,
      uppercase: looksLikeAllCaps(line.text),
    }))
  );

  const fallbackText = result?.data?.text
    ? result.data.text.trim()
    : null;

  const rawText = bestLine?.text?.trim() || fallbackText || null;

  if (!rawText) {
    console.warn("[identify-room] No suitable OCR text detected");
    return { roomName: null, rawText: null, confidence: 0 };
  }

  const roomName = clean ? cleanHeading(rawText) : rawText;
  const confidence = bestLine?.confidence ?? 0;
  console.log(
    `[identify-room] Selected heading="${roomName}" (raw="${rawText}", confidence=${confidence})`
  );

  return {
    roomName,
    rawText,
    confidence,
    previewPath: cropDebugSettings.previewPath || null,
  };
}

async function cropTopRegion(
  imagePath,
  topCropRatio,
  innerBandRatio,
  innerWidthRatio,
  debugSettings = {}
) {
  const image = sharp(imagePath);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Unable to read image dimensions for ${imagePath}`);
  }

  const cropHeight = Math.max(1, Math.round(metadata.height * topCropRatio));
  const bandHeight = Math.max(1, Math.round(cropHeight * innerBandRatio));
  const remaining = Math.max(0, cropHeight - bandHeight);
  const bandTopOffset = Math.max(
    0,
    Math.min(metadata.height - bandHeight, Math.round(remaining / 2))
  );

  const cropWidth = metadata.width;
  const innerWidth = Math.max(1, Math.round(cropWidth * innerWidthRatio));
  const horizontalRemaining = Math.max(0, cropWidth - innerWidth);
  const bandLeftOffset = Math.max(
    0,
    Math.min(metadata.width - innerWidth, Math.round(horizontalRemaining / 2))
  );

  console.log(
    `[identify-room] cropTopRegion -> totalHeight=${metadata.height}, cropHeight=${cropHeight}, bandHeight=${bandHeight}, bandTopOffset=${bandTopOffset}, totalWidth=${metadata.width}, innerWidth=${innerWidth}, bandLeftOffset=${bandLeftOffset}`
  );

  const cropped = await image
    .extract({
      left: bandLeftOffset,
      top: bandTopOffset,
      width: innerWidth,
      height: bandHeight,
    })
    .greyscale()
    .normalize()
    .sharpen()
    .toBuffer();

  const outputPath = debugSettings.outputPath || null;
  if (outputPath) {
    try {
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
      await sharp(cropped).toFile(outputPath);
      debugSettings.previewPath = outputPath;
      console.log(
        `[identify-room] Debug crop written to ${outputPath}`
      );
    } catch (error) {
      console.warn(
        "[identify-room] Failed to write debug output:",
        error.message || error
      );
    }
  }

  return cropped;
}

async function assertFileReadable(targetPath) {
  return fs.promises.access(targetPath, fs.constants.R_OK);
}

function cleanHeading(text) {
  if (!text) return text;

  let cleaned = text.replace(/\s+/g, " ").trim();

  cleaned = cleaned.replace(/[^A-Za-z\s]+/g, " ").replace(/\s+/g, " ").trim();

  const separatorMatch = cleaned.split(/\s*[-–—|]\s*/);
  if (separatorMatch.length > 1) {
    cleaned = separatorMatch[0];
  }

  cleaned = cleaned.replace(/^[^\w]+|[^\w]+$/g, "");

  cleaned = cleaned
    .toLowerCase()
    .split(" ")
    .map((word) => {
      if (!word) return word;
      if (/^\d+$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");

  return cleaned;
}

function looksLikeAllCaps(text = "") {
  const normalized = text.replace(/\s+/g, "").replace(/[^A-Za-z0-9]/g, "");
  if (normalized.length === 0) return false;
  const alphaChars = normalized.replace(/\d/g, "");
  if (alphaChars.length === 0) return false;
  return alphaChars === alphaChars.toUpperCase();
}

module.exports = {
  identifyRoomName,
};

if (require.main === module) {
  const [, , imageArg] = process.argv;
  if (!imageArg) {
    console.error("Usage: node identify-room.js <path-to-image>");
    process.exit(1);
  }

  identifyRoomName(imageArg)
    .then((result) => {
      console.log(result.roomName || "(no room identified)");
    })
    .catch((error) => {
      console.error("Failed to identify room name:", error.message || error);
      process.exit(1);
    });
}

