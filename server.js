const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { pdfGenerate } = require("./PDFGenerate");

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads and temp directories exist
const uploadsDir = path.join(__dirname, "uploads");
const tempBaseDir = path.join(__dirname, "temp");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(tempBaseDir)) {
  fs.mkdirSync(tempBaseDir, { recursive: true });
}

// Configure multer for file uploads
const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"), false);
    }
  },
});

// Middleware
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Main processing endpoint
app.post("/process", upload.single("pdf"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No PDF file uploaded" });
  }

  const uploadedPdfPath = req.file.path;
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const tempDir = path.join(__dirname, "temp", requestId);

  try {
    // Create temp directory for this request
    await fs.promises.mkdir(tempDir, { recursive: true });
    const pagesDir = path.join(tempDir, "pdf-pages");
    const outputDir = path.join(tempDir, "generated");

    console.log(`[Server] Processing request ${requestId} for file: ${req.file.originalname}`);

    // Parse query parameters for options
    const options = {
      pagesDir,
      outputDir,
      skipConversionPages: req.query.skipConversion ? parseInt(req.query.skipConversion) : 4,
      skipPages: req.query.skip ? parseInt(req.query.skip) : 0,
      concurrency: req.query.concurrency ? parseInt(req.query.concurrency) : 2,
      continueOnError: req.query.continue === "true",
      mergeOutput: req.query.merge !== "false", // Default to true
      pdfOptions: {
        dpi: req.query.dpi ? parseInt(req.query.dpi) : 110,
      },
    };

    // Process the PDF
    const result = await pdfGenerate(uploadedPdfPath, options);

    // Delete input PDF immediately after processing to free memory
    try {
      await fs.promises.unlink(uploadedPdfPath);
      console.log(`[Server] Deleted input PDF for request ${requestId}`);
    } catch (unlinkError) {
      console.warn(`[Server] Failed to delete input PDF for request ${requestId}:`, unlinkError.message);
    }

    // Check if merge was successful
    if (!result.mergedPdfPath || !fs.existsSync(result.mergedPdfPath)) {
      throw new Error("Failed to generate merged PDF");
    }

    // Read merged PDF and send response
    const mergedPdfPath = result.mergedPdfPath;
    const pdfBuffer = await fs.promises.readFile(mergedPdfPath);
    const outputFilename = req.query.filename || `processed-${requestId}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${outputFilename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);

    console.log(`[Server] Sending PDF response for request ${requestId} (${pdfBuffer.length} bytes)`);
    
    // Send response
    res.send(pdfBuffer);
    
    // Delete merged PDF immediately after sending (non-blocking)
    setImmediate(async () => {
      try {
        // Delete merged PDF file first
        if (fs.existsSync(mergedPdfPath)) {
          await fs.promises.unlink(mergedPdfPath);
          console.log(`[Server] Deleted merged PDF for request ${requestId}`);
        }
        // Then cleanup entire temp directory
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        console.log(`[Server] Cleaned up temp directory for request ${requestId}`);
      } catch (cleanupError) {
        console.warn(`[Server] Cleanup error for request ${requestId}:`, cleanupError.message);
      }
    });

  } catch (error) {
    console.error(`[Server] Error processing request ${requestId}:`, error);

    // Cleanup on error
    try {
      await fs.promises.unlink(uploadedPdfPath).catch(() => {});
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    } catch (cleanupError) {
      console.warn(`[Server] Cleanup error:`, cleanupError.message);
    }

    res.status(500).json({
      error: "Failed to process PDF",
      message: error.message,
      requestId,
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Maximum size is 100MB" });
    }
    return res.status(400).json({ error: error.message });
  }
  res.status(500).json({ error: error.message || "Internal server error" });
});

// Start server
app.listen(PORT, () => {
  console.log(`[Server] PDF processing server running on port ${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/health`);
  console.log(`[Server] Process endpoint: POST http://localhost:${PORT}/process`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[Server] SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[Server] SIGINT received, shutting down gracefully");
  process.exit(0);
});

