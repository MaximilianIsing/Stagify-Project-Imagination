const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

function readApiKey(explicitKey, keyFile) {
  if (explicitKey) return explicitKey;

  const candidates = [
    keyFile,
    path.resolve(process.cwd(), "gpt-key.txt"),
    path.resolve(process.cwd(), "key.txt"),
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

  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }

  throw new Error(
    "OpenAI API key not found. Provide one via options.apiKey, OPENAI_API_KEY, or gpt-key.txt/key.txt."
  );
}

async function describeSpaceFromFloorplan(imagePaths, options = {}) {
  const inputPaths = Array.isArray(imagePaths) ? imagePaths : [imagePaths];
  if (!inputPaths.length) {
    throw new Error("At least one imagePath is required");
  }

  const resolvedImages = await Promise.all(
    inputPaths.map(async (p) => {
      const resolved = path.resolve(p);
      await fs.promises.access(resolved, fs.constants.R_OK);
      console.log(`[describe] Resolved image path: ${resolved}`);
      return resolved;
    })
  );

  const apiKey = readApiKey(options.apiKey, options.keyFile);
  const openai = new OpenAI({ apiKey });
  console.log("[describe] OpenAI client initialized");

  const imageParts = await Promise.all(
    resolvedImages.map(async (resolved) => {
      const imageBuffer = await fs.promises.readFile(resolved);
      const fileExt =
        path.extname(resolved).replace(".", "").toLowerCase() || "png";
      console.log(
        `[describe] Loaded image ${resolved} (${imageBuffer.length} bytes, ext=${fileExt})`
      );
      return {
        type: "input_image",
        image_url: `data:image/${fileExt === "jpg" ? "jpeg" : fileExt};base64,${imageBuffer.toString("base64")}`,
        path: resolved,
      };
    })
  );

  const prompt =
    options.prompt ||
    buildPromptWithContext(options.roomContext || {});
  console.log(
    "[describe] Prompt length:",
    prompt.length,
    "characters. Image count:",
    imageParts.length
  );

  const response = await openai.responses.create({
    model: options.model || "gpt-4o-mini",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          ...imageParts.map((part) => ({ type: part.type, image_url: part.image_url })),
        ],
      },
    ],
  });
  console.log("[describe] Received OpenAI response");

  const rawOutput =
    response.output_text ??
    response.content?.map((item) => item.text).filter(Boolean).join("\n").trim();

  if (!rawOutput) {
    console.error("[describe] No text output in OpenAI response");
    throw new Error("No textual output returned from the OpenAI response.");
  }

  const trimmed = rawOutput.trim();
  console.log("[describe] Raw output length:", trimmed.length);
  const marker = "GEOMETRY_JSON";
  const markerIndex = trimmed.indexOf(marker);

  if (markerIndex === -1) {
    console.warn("[describe] GEOMETRY_JSON marker not found in response");
    return { narrative: trimmed, geometry: null, raw: trimmed };
  }

  const narrative = trimmed.slice(0, markerIndex).trim();
  console.log("[describe] Narrative length:", narrative.length);
  const jsonStart = trimmed.indexOf("{", markerIndex);
  const jsonEnd = trimmed.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    console.warn("[describe] Unable to locate JSON block after marker");
    return { narrative: trimmed, geometry: null, raw: trimmed };
  }

  let geometry = null;
  const jsonText = trimmed.slice(jsonStart, jsonEnd + 1);
  try {
    geometry = JSON.parse(jsonText);
    console.log("[describe] Parsed geometry JSON successfully");
  } catch (error) {
    console.error("[describe] Failed to parse geometry JSON:", error);
    geometry = null;
  }

  return { narrative, geometry, raw: trimmed, geometryText: geometry ? jsonText : null };
}

module.exports = { describeSpaceFromFloorplan };

function buildPromptWithContext(roomContext) {
  const basePrompt = [
    "You are an architectural visualization assistant.",
    "You receive a design board page composed of:",
    "- The primary floorplan or elevation in the main panel (usually upper-left).",
    "- Adjacent reference imagery showing the furniture, fixtures, artwork, or decor planned for the room.",
    "- A colour/material palette swatch panel in the lower-right corner.",
    "Some rooms may include multiple board pages; when more than one image is supplied they describe the same room. Integrate every supplied reference so the deliverable covers all furniture, finishes, and palette callouts across the pages.",
  ];

  if (roomContext?.roomName) {
    basePrompt.push(
      `The overall room heading detected for this set is "${roomContext.roomName}".`
    );
  }

  const headingSummaries = Array.isArray(roomContext?.headings)
    ? roomContext.headings
        .map((heading, index) => {
          const label =
            heading?.rawText ||
            heading?.roomName ||
            `Unlabeled Page ${index + 1}`;
          return `Page ${index + 1} heading: "${label}"`;
        })
        .filter(Boolean)
    : [];

  if (headingSummaries.length > 0) {
    basePrompt.push(
      "The supplied images correspond to the same room but cover different facets. Use every page listed below when compiling the specification:",
      ...headingSummaries,
      "Treat sub-headings such as bedding, artwork, lighting, etc. as additive requirements for the same room—do not treat them as separate spaces."
    );
  }

  basePrompt.push(
    "Produce a comprehensive, quantitative brief that will be fed to a 3D generative model to recreate this exact room.",
    "Explicitly include:",
    "- Overall room dimensions (length, width, ceiling height) and orientation.",
    "- For each wall, note length, directions, and any openings (doors, windows) with approximate widths/heights and offsets.",
    "- Enumerate every furniture/fixture piece shown in the reference images: describe style, materials, colors, approximate dimensions, and intended placement relative to walls and other items. Call out exact quantities (e.g., number of dining chairs) and ensure they match the imagery.",
    "- If dimension labels or textual annotations appear on the collage or furniture photography, read them to infer size but do not treat the text itself as part of the visual design; note explicitly that such labels should not appear in the final render.",
    "- Integrate the colour palette: specify wall paint, trim, flooring, textiles, accent colors, metals, and any artwork tones, ensuring the palette corresponds to the swatch panel.",
    "- Lighting details (fixtures, placement, colour temperature) plus accessory/prop notes (plants, art, tableware).",
    "- Deduce the intended camera/viewpoint for the hero render (typically from the main entry looking toward the feature wall). State this explicitly and then specify each furniture/fixture location relative to that camera: left/right offset, forward/back distance, vertical elevation.",
    "- After the narrative, output a JSON object under the heading `GEOMETRY_JSON` with the precise layout data in feet, following this schema:",
    '{ "room": { "length_ft": number, "width_ft": number, "ceiling_ft": number }, "openings": [{ "type": "door|window", "wall": "north|south|east|west", "width_ft": number, "height_ft": number, "offset_ft": number }], "fixtures": [{ "name": "string", "quantity": number, "dimensions_ft": [length, depth, height], "position_ft": { "from_west": number, "from_north": number }, "orientation": "faces X wall" }] }',
    "- Do not include any extra commentary after the JSON block.",
    "Respond with the narrative first, then the line `GEOMETRY_JSON` on its own line, followed immediately by the JSON object."
  );

  return basePrompt.join(" ");
}

