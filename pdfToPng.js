const fs = require("fs");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
pdfjsLib.GlobalWorkerOptions.workerSrc = undefined;
const suppressedWarningPatterns = [
  /Optional content group not found/i,
  /getOperatorList/i,
  /getPathGenerator/i,
  /fetchStandardFontData/i,
];

class NodeCanvasFactory {
  create(width, height) {
    if (width <= 0 || height <= 0) {
      throw new Error("Invalid canvas size");
    }
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }

  reset(canvasAndContext, width, height) {
    if (width <= 0 || height <= 0) {
      throw new Error("Invalid canvas size");
    }
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

async function pdfToPngs(pdfPath, outputDir, options = {}) {
  const originalWarn = console.warn;
  const originalLog = console.log;
  const filter = (originalFn, args) => {
    const text = args.join(" ");
    if (suppressedWarningPatterns.some((pattern) => pattern.test(text))) {
      return;
    }
    originalFn(...args);
  };

  console.warn = (...args) => {
    filter(originalWarn, args);
  };
  console.log = (...args) => {
    filter(originalLog, args);
  };

  const { dpi = 110, filePrefix = "page", padPages = true, skipPages = 0 } = options;
  const scale = dpi / 72;

  if (!pdfPath) {
    throw new Error("pdfPath is required");
  }
  if (!outputDir) {
    throw new Error("outputDir is required");
  }

  originalLog("[pdfToPng] Starting conversion", {
    pdfPath: path.resolve(pdfPath),
    outputDir: path.resolve(outputDir),
    options,
  });

  try {
    await fs.promises.mkdir(outputDir, { recursive: true });
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const loadingTask = pdfjsLib.getDocument({ data, disableWorker: true });
    const pdfDocument = await loadingTask.promise;
    const totalPages = pdfDocument.numPages;
    const padLength = padPages ? String(totalPages).length : 1;
    const results = [];
    const startPage = Math.max(1, skipPages + 1);

    originalLog("[pdfToPng] Total pages:", totalPages);
    if (skipPages > 0) {
      originalLog(`[pdfToPng] Skipping first ${skipPages} page(s), starting from page ${startPage}`);
    }

    for (let pageNum = startPage; pageNum <= totalPages; pageNum += 1) {
      originalLog("[pdfToPng] Rendering page", pageNum);
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvasFactory = new NodeCanvasFactory();
      const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);
      const renderContext = {
        canvasContext: context,
        viewport,
        canvasFactory,
      };

      await page.render(renderContext).promise;

      // Calculate output page number (1-based for first converted page)
      const outputPageNum = pageNum - skipPages;
      const pageIndex = padPages ? String(outputPageNum).padStart(padLength, "0") : String(outputPageNum);
      const filename = `${filePrefix}-${pageIndex}.png`;
      const outputPath = path.resolve(outputDir, filename);

      const pngBuffer = await canvas.encode("png");
      await fs.promises.writeFile(outputPath, pngBuffer);
      results.push(outputPath);
      originalLog(
        "[pdfToPng] Wrote page image",
        outputPath,
        "size:",
        pngBuffer.length
      );
      canvasFactory.destroy({ canvas, context });
    }

    originalLog("[pdfToPng] Completed conversion.");
    return results;
  } finally {
    console.warn = originalWarn;
    console.log = originalLog;
  }
}

module.exports = { pdfToPngs };

if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);
    if (argv.length === 0) {
      console.log("Usage: node pdfToPng.js <pdfPath> [outputDir] [--dpi=144] [--prefix=page] [--no-pad] [--skip-pages=0]");
      process.exit(1);
    }

    const inputPdf = argv[0];
    let outputDir = argv[1];
    const optionArgs = [];

    if (!outputDir || outputDir.startsWith("--")) {
      optionArgs.push(...argv.slice(1));
      outputDir = path.resolve(process.cwd(), "pdf-pages");
    } else {
      optionArgs.push(...argv.slice(2));
      outputDir = path.resolve(process.cwd(), outputDir);
    }

    const options = {};
    for (const arg of optionArgs) {
      if (!arg.startsWith("--")) {
        continue;
      }
      if (arg.startsWith("--dpi=")) {
        const value = Number(arg.slice("--dpi=".length));
        if (!Number.isNaN(value) && value > 0) {
          options.dpi = value;
        }
      } else if (arg.startsWith("--prefix=")) {
        options.filePrefix = arg.slice("--prefix=".length);
      } else if (arg === "--no-pad") {
        options.padPages = false;
      } else if (arg.startsWith("--skip-pages=")) {
        const value = Number(arg.slice("--skip-pages=".length));
        if (!Number.isNaN(value) && value >= 0) {
          options.skipPages = value;
        }
      }
    }

    try {
      const results = await pdfToPngs(inputPdf, outputDir, options);
      console.log(`Wrote ${results.length} file(s) to ${outputDir}`);
    } catch (error) {
      console.error(error.message || error);
      process.exitCode = 1;
    }
  })();
}
