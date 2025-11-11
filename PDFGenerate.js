const path = require("path");
const fs = require("fs");
const { pdfToPngs } = require("./pdfToPng");
const { describePageAndGenerate } = require("./page-processing");
const { identifyRoomName } = require("./identify-room");
const { addTitleToImage } = require("./text-adder");
const { outputMerge } = require("./output-merge");

// Toggle to keep all intermediate files (true) or only keep the final PDF (false)
// If true: Keep all PNG files in other folders
// If false: Delete all PNG files in other folders
const output_all = false;

async function pdfGenerate(pdfPath, options = {}) {
  if (!pdfPath) {
    throw new Error("pdfPath is required");
  }

  const resolvedPdf = path.resolve(pdfPath);
  const pagesDir = options.pagesDir
    ? path.resolve(options.pagesDir)
    : path.resolve(process.cwd(), "pdf-pages");
  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.resolve(process.cwd(), "generated");
  const skipConversionPages = Number.isInteger(options.skipConversionPages) ? options.skipConversionPages : 4;
  const skipPages = Number.isInteger(options.skipPages) ? options.skipPages : 0;
  const continueOnError = Boolean(options.continueOnError);
  const pdfOptions = { ...(options.pdfOptions || {}), skipPages: skipConversionPages };
  const concurrency =
    Number.isInteger(options.concurrency) && options.concurrency > 0
      ? options.concurrency
      : 2;

  console.log("[PDFGenerate] Rendering PDF pages:", resolvedPdf);
  const pageImages = await pdfToPngs(resolvedPdf, pagesDir, pdfOptions);
  console.log(
    `[PDFGenerate] Rendered ${pageImages.length} page image(s) to ${pagesDir}`
  );

  if (skipPages >= pageImages.length) {
    console.warn(
      `[PDFGenerate] Requested to skip ${skipPages} page(s), but only ${pageImages.length} were rendered. Nothing to process.`
    );
    return {
      pagesDir,
      outputDir,
      pageImages,
      processedPages: [],
    };
  }

  const pagesToProcess = pageImages.slice(skipPages);
  console.log(
    `[PDFGenerate] Processing ${pagesToProcess.length} page(s) starting from index ${skipPages}`
  );

  if (pagesToProcess.length === 0) {
    return {
      pagesDir,
      outputDir,
      pageImages,
      processedPages: [],
      skipPages,
      concurrency: 0,
    };
  }

  const identifyOptions = options.identifyRoomOptions || {};
  const roomDetections = [];
  for (let i = 0; i < pagesToProcess.length; i += 1) {
    const pagePath = pagesToProcess[i];
    console.log(`[PDFGenerate] Identifying room for page ${pagePath}`);
    try {
      const detection = await identifyRoomName(pagePath, identifyOptions);
      const normalized = normalizeRoomName(
        detection.roomName || detection.rawText
      );
      roomDetections.push({
        ...detection,
        normalized,
        pageImage: pagePath,
      });
      console.log(
        `[PDFGenerate] Room heading detected for ${path.basename(
          pagePath
        )}: ${detection.roomName || detection.rawText || "(none)"}`
      );
    } catch (error) {
      console.warn(
        `[PDFGenerate] Failed to identify room heading for ${pagePath}:`,
        error.message || error
      );
      roomDetections.push({
        roomName: null,
        rawText: null,
        confidence: 0,
        normalized: null,
        pageImage: pagePath,
        error,
      });
      if (!continueOnError) {
        throw error;
      }
    }
  }

  const groups = [];
  for (let index = 0; index < pagesToProcess.length; ) {
    const detection = roomDetections[index];
    console.log(
      `[PDFGenerate] Creating group starting at index ${index} (${pagesToProcess[index]})`
    );
    const normalized = detection?.normalized;
    const group = {
      groupId: groups.length + 1,
      pageIndices: [index],
      pages: [pagesToProcess[index]],
      roomName: detection?.roomName || detection?.rawText || null,
      normalizedName: normalized,
    };

    let cursor = index + 1;
    if (normalized) {
      while (cursor < pagesToProcess.length) {
        const nextDetection = roomDetections[cursor];
        console.log(
          `[PDFGenerate] Comparing page ${pagesToProcess[cursor]} (normalized=${nextDetection?.normalized}) with current group normalized=${normalized}`
        );
        if (
          nextDetection?.normalized &&
          nextDetection.normalized === normalized
        ) {
          group.pageIndices.push(cursor);
          group.pages.push(pagesToProcess[cursor]);
          cursor += 1;
        } else {
          break;
        }
      }
    }

    groups.push(group);
    index = cursor;
  }

  console.log(
    `[PDFGenerate] Grouped ${pagesToProcess.length} page(s) into ${groups.length} task(s).`
  );

  const processedPages = new Array(pagesToProcess.length);
  console.log(
    "[PDFGenerate] Groups detail:",
    groups.map((group) => ({
      groupId: group.groupId,
      pages: group.pages,
      roomName: group.roomName,
      normalizedName: group.normalizedName,
    }))
  );
  let groupCursor = 0;

  const workerCount = Math.min(concurrency, groups.length);
  console.log(
    `[PDFGenerate] Using concurrency level ${workerCount} (requested ${concurrency})`
  );

  async function worker(workerId) {
    while (true) {
      const currentGroupIndex = groupCursor;
      if (currentGroupIndex >= groups.length) {
        break;
      }
      groupCursor = currentGroupIndex + 1;

      const group = groups[currentGroupIndex];
      const groupLabel =
        group.roomName || group.normalizedName || "(room unidentified)";

      console.log(
        `[PDFGenerate][Worker ${workerId}] Processing group ${currentGroupIndex + 1}/${
          groups.length
        }: ${groupLabel} (${group.pages.length} page(s))`
      );

      try {
        const result = await describePageAndGenerate(group.pages, {
          outputDir,
          geminiKeyFile: options.geminiKeyFile,
          describe: options.describeOptions,
          roomContext: {
            roomName: group.roomName,
            normalizedName: group.normalizedName,
            headings: group.pageIndices.map((pageIndex) => ({
              pageImage: pagesToProcess[pageIndex],
              roomName: roomDetections[pageIndex]?.roomName || null,
              rawText: roomDetections[pageIndex]?.rawText || null,
              confidence: roomDetections[pageIndex]?.confidence ?? null,
            })),
          },
        });

        const headingSourceIndex =
          group.pageIndices.length > 0
            ? group.pageIndices[0]
            : null;
        const headingSource =
          (headingSourceIndex !== null && roomDetections[headingSourceIndex]) ||
          {};
        const titleText =
          (headingSource.rawText && headingSource.rawText.trim()) ||
          (group.roomName && group.roomName.trim()) ||
          (headingSource.roomName && headingSource.roomName.trim()) ||
          (group.normalizedName &&
            group.normalizedName
              .split(" ")
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(" ")) ||
          "Room";

        console.log(
          `[PDFGenerate][Worker ${workerId}] Overlaying title "${titleText}" onto ${result.renderPath}`
        );
        await addTitleToImage(result.renderPath, titleText, {
          outputPath: result.renderPath,
        });

        group.pageIndices.forEach((pageIndex, localIndex) => {
          const companions = group.pages.filter((_, idx) => idx !== localIndex);
          processedPages[pageIndex] = {
            pageImage: pagesToProcess[pageIndex],
            groupedWith: companions,
            groupId: group.groupId,
            roomName: roomDetections[pageIndex]?.roomName || null,
            roomHeadingRaw: roomDetections[pageIndex]?.rawText || null,
            description: result.description,
            renderPath: result.renderPath,
            error: null,
            errorMessage: null,
          };
        });

        console.log(
          `[PDFGenerate][Worker ${workerId}] Completed group ${groupLabel}. Render path: ${result.renderPath}`
        );
      } catch (error) {
        console.error(
          `[PDFGenerate][Worker ${workerId}] Error processing group ${groupLabel}:`,
          error.message || error
        );

        group.pageIndices.forEach((pageIndex, localIndex) => {
          const companions = group.pages.filter((_, idx) => idx !== localIndex);
          processedPages[pageIndex] = {
            pageImage: pagesToProcess[pageIndex],
            groupedWith: companions,
            groupId: group.groupId,
            roomName: roomDetections[pageIndex]?.roomName || null,
            roomHeadingRaw: roomDetections[pageIndex]?.rawText || null,
            description: null,
            renderPath: null,
            error,
            errorMessage: error && (error.message || String(error)),
          };
        });

        if (!continueOnError) {
          throw error;
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, (_, index) => worker(index + 1))
  );

  console.log("[PDFGenerate] Final processedPages summary:", {
    total: processedPages.length,
    successes: processedPages.filter((entry) => entry && !entry.error).length,
    failures: processedPages.filter((entry) => entry && entry.error).length,
  });

  // Merge all output images into a final PDF
  const shouldMerge = options.mergeOutput !== false; // Default to true unless explicitly disabled
  let mergedPdfPath = null;
  if (shouldMerge) {
    try {
      console.log("[PDFGenerate] Merging output images into PDF...");
      // Save merged PDF in root directory by default
      const defaultMergedPath = options.mergedOutputPath || path.resolve(process.cwd(), "merged-output.pdf");
      const mergeResult = await outputMerge({
        outputDir,
        outputPath: defaultMergedPath,
      });
      mergedPdfPath = mergeResult.outputPath;
      console.log(`[PDFGenerate] Successfully merged ${mergeResult.imageCount} image(s) into PDF: ${mergedPdfPath}`);
      
      // Clean up intermediate PNG files if output_all is false
      if (!output_all) {
        console.log("[PDFGenerate] Cleaning up intermediate PNG files...");
        try {
          // Delete PNG files from generated directory
          if (fs.existsSync(outputDir)) {
            const outputFiles = await fs.promises.readdir(outputDir);
            let deletedCount = 0;
            for (const file of outputFiles) {
              if (path.extname(file).toLowerCase() === ".png") {
                const filePath = path.join(outputDir, file);
                await fs.promises.unlink(filePath);
                deletedCount++;
              }
            }
            console.log(`[PDFGenerate] Deleted ${deletedCount} PNG file(s) from ${outputDir}`);
          }
          
          // Delete PNG files from pdf-pages directory
          if (fs.existsSync(pagesDir)) {
            const pageFiles = await fs.promises.readdir(pagesDir);
            let deletedPageCount = 0;
            for (const file of pageFiles) {
              if (path.extname(file).toLowerCase() === ".png") {
                const filePath = path.join(pagesDir, file);
                await fs.promises.unlink(filePath);
                deletedPageCount++;
              }
            }
            console.log(`[PDFGenerate] Deleted ${deletedPageCount} PNG file(s) from ${pagesDir}`);
          }
        } catch (cleanupError) {
          console.warn("[PDFGenerate] Error during cleanup:", cleanupError.message || cleanupError);
          // Don't throw - cleanup errors shouldn't break the process
        }
      }
    } catch (error) {
      console.warn("[PDFGenerate] Failed to merge output images:", error.message || error);
      // Don't throw - merging is optional and shouldn't break the main process
    }
  }

  return {
    pagesDir,
    outputDir,
    pageImages,
    processedPages,
    skipPages,
    concurrency: workerCount,
    groups,
    roomDetections,
    mergedPdfPath,
  };
}

function normalizeRoomName(name) {
  if (!name) return null;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { pdfGenerate };

if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);
    if (argv.length === 0) {
      console.log(
        "Usage: node PDFGenerate.js <input.pdf> [--pagesDir=pdf-pages] [--outputDir=generated] [--skip-conversion=4] [--skip=0] [--continue] [--concurrency=2] [--dpi=110] [--no-merge] [--merged-output=path/to/output.pdf]"
      );
      process.exit(1);
    }

    const pdfPath = argv[0];
    const cliOptions = {};
    for (const arg of argv.slice(1)) {
      if (!arg.startsWith("--")) continue;
      const [flag, value] = arg.slice(2).split("=");
      if (flag === "pagesDir") {
        cliOptions.pagesDir = value;
      } else if (flag === "outputDir") {
        cliOptions.outputDir = value;
      } else if (flag === "skip") {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) {
          cliOptions.skipPages = parsed;
        }
      } else if (flag === "skip-conversion") {
        const parsed = Number(value);
        if (!Number.isNaN(parsed) && parsed >= 0) {
          cliOptions.skipConversionPages = parsed;
        }
      } else if (flag === "continue") {
        cliOptions.continueOnError = true;
      } else if (flag === "concurrency") {
        const parsed = Number(value);
        if (!Number.isNaN(parsed) && parsed > 0) {
          cliOptions.concurrency = parsed;
        }
      } else if (flag === "dpi") {
        cliOptions.pdfOptions = cliOptions.pdfOptions || {};
        const parsed = Number(value);
        if (!Number.isNaN(parsed) && parsed > 0) {
          cliOptions.pdfOptions.dpi = parsed;
        }
      } else if (flag === "prefix") {
        cliOptions.pdfOptions = cliOptions.pdfOptions || {};
        cliOptions.pdfOptions.filePrefix = value;
      } else if (flag === "no-pad") {
        cliOptions.pdfOptions = cliOptions.pdfOptions || {};
        cliOptions.pdfOptions.padPages = false;
      } else if (flag === "gemini-key") {
        cliOptions.geminiKeyFile = value;
      } else if (flag === "no-merge") {
        cliOptions.mergeOutput = false;
      } else if (flag === "merged-output") {
        cliOptions.mergedOutputPath = value;
      }
    }

    try {
      const result = await pdfGenerate(pdfPath, cliOptions);
      const successCount = result.processedPages.filter(
        (entry) => entry && !entry.error
      ).length;
      const errorCount = result.processedPages.filter(
        (entry) => entry && entry.error
      ).length;
      console.log(
        `[PDFGenerate] Completed ${successCount} page(s); ${errorCount} error(s).`
      );
      if (errorCount > 0) {
        console.warn(
          "[PDFGenerate] Some pages failed during processing. Check logs for details."
        );
      }
    } catch (error) {
      console.error(error.message || error);
      process.exitCode = 1;
    }
  })();
}

