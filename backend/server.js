require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const userStorage = require("./userStorage");

const app = express();
const port = Number(process.env.PORT) || 5050;

app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({
  origin: (process.env.FRONTEND_ORIGIN || `http://localhost:${port}`)
    .split(",")
    .map((x) => x.trim()),
  methods: ["GET", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "200kb" }));
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    app: "bloom-backend"
  });
});

app.use("/api", userStorage);

app.use(express.static(path.join(__dirname, "..")));

app.use((err, _req, res, _next) => {
  console.error("[server]", err.message);
  res.status(500).json({
    error: "Unexpected server error."
  });
});

app.listen(port, () => {
  console.log(`Bloom backend: http://localhost:${port}`);
  console.log(`Health check: http://localhost:${port}/api/health`);
});