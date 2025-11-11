const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

function readGeminiKey(explicitKey, keyFile) {
  if (explicitKey) return explicitKey;

  const candidates = [
    keyFile,
    path.resolve(process.cwd(), "key.txt"),
    path.resolve(process.cwd(), "gemini-key.txt"),
  ].filter(Boolean);

  for (const filePath of candidates) {
    try {
      const key = fs.readFileSync(filePath, "utf8").trim();
      if (key) {
        return key;
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY.trim();
  }

  throw new Error(
    "Gemini API key not found. Provide one via options.apiKey, GEMINI_API_KEY, or key.txt/gemini-key.txt."
  );
}

function extractInlineImage(response) {
  const parts =
    response?.response?.candidates?.[0]?.content?.parts ||
    response?.candidates?.[0]?.content?.parts ||
    [];

  for (const part of parts) {
    if (part.inlineData?.data) {
      return Buffer.from(part.inlineData.data, "base64");
    }
  }
  return null;
}

async function generateRoomImage(description, options = {}) {
  if (!description) {
    throw new Error("description is required");
  }

  const apiKey = readGeminiKey(options.apiKey, options.keyFile);
  const ai = new GoogleGenAI({ apiKey });
  console.log("Gemini prompt (truncated):", description.slice(0, 400));
  console.log(
    "generateRoomImage options:",
    JSON.stringify({ ...options, referenceImages: undefined, referenceImage: undefined })
  );
  const promptParts = [
    {
      role: "user",
      parts: [
        {
          text: options.negativePrompt
            ? `${description}\n\nAvoid: ${options.negativePrompt}`
            : description,
        },
      ],
    },
  ];

  const referenceImages = [];
  if (Array.isArray(options.referenceImages) && options.referenceImages.length) {
    referenceImages.push(...options.referenceImages);
  } else if (options.referenceImage) {
    referenceImages.push(options.referenceImage);
  }

  referenceImages.forEach((reference, index) => {
    if (!reference) return;
    const mimeType = reference.mimeType || "image/png";
    promptParts[0].parts.push({
      inlineData: {
        mimeType,
        data: reference.data,
      },
    });
    console.log(
      `Attached reference image #${index + 1} with mimeType:`,
      mimeType
    );
  });

  const response = await ai.models.generateContent({
    model: options.model || "gemini-2.5-flash-image",
    contents: promptParts,
  });
  console.log("Gemini response metadata:", JSON.stringify({
    hasResponse: Boolean(response),
    candidateCount: response?.response?.candidates?.length ?? response?.candidates?.length ?? 0,
  }));

  console.log(
    "Gemini raw response summary:",
    JSON.stringify(response?.response?.candidates?.[0]?.content?.parts || [], null, 2).slice(0, 400)
  );

  const candidate =
    response?.response?.candidates?.[0] || response?.candidates?.[0] || null;

  const contentParts = candidate?.content?.parts || response?.parts || [];

  let imageBuffer = null;
  for (const part of contentParts) {
    if (part.inlineData?.data) {
      imageBuffer = Buffer.from(part.inlineData.data, "base64");
      break;
    }
  }

  if (!imageBuffer) {
    const fallback =
      contentParts
        .map((part) => part.text)
        .filter(Boolean)
        .join("\n")
        .trim() || "No inline image data returned.";
    console.error(
      "Gemini response contained no image data. Fallback text:",
      fallback
    );
    throw new Error(
      `Image generation completed but no image data was provided. Model said: ${fallback}`
    );
  }

  let outputPath = options.outputPath;
  if (options.writeFile !== false) {
    const resolvedOutput =
      outputPath || path.resolve(process.cwd(), `room-${Date.now()}.png`);
    await fs.promises.writeFile(resolvedOutput, imageBuffer);
    outputPath = resolvedOutput;
    console.log("generateRoomImage wrote file:", outputPath);
  }

  return {
    imageBuffer,
    outputPath,
  };
}

module.exports = { generateRoomImage };

if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);
    if (argv.length === 0) {
      console.log(
        "Usage: node generate-room.js <description-or-file> [--output=room.png] [--size=1024x1024] [--model=models/imagegeneration]"
      );
      process.exit(1);
    }

    const descriptionArg = argv[0];
    const cliOptions = {};

    for (const arg of argv.slice(1)) {
      if (!arg.startsWith("--")) continue;
      const [flag, value = ""] = arg.slice(2).split("=");
      if (flag === "output") {
        cliOptions.outputPath = value;
      } else if (flag === "size") {
        cliOptions.size = value;
      } else if (flag === "model") {
        cliOptions.model = value;
      } else if (flag === "negative") {
        cliOptions.negativePrompt = value;
      } else if (flag === "key-file") {
        cliOptions.keyFile = value;
      } else if (flag === "no-write") {
        cliOptions.writeFile = false;
      }
    }

    let description = descriptionArg;
    try {
      const possiblePath = path.resolve(descriptionArg);
      const stats = fs.existsSync(possiblePath) && fs.statSync(possiblePath);
      if (stats && stats.isFile()) {
        description = fs.readFileSync(possiblePath, "utf8");
      }
    } catch (error) {
      // Ignore and treat as raw text.
    }

    try {
      const { outputPath } = await generateRoomImage(description, cliOptions);
      if (cliOptions.writeFile === false) {
        console.log("Image generated (not written to disk).");
      } else {
        console.log(`Image written to ${outputPath}`);
      }
    } catch (error) {
      console.error(error.message || error);
      process.exitCode = 1;
    }
  })();
}

