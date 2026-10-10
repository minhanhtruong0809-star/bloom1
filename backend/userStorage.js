const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = url && serviceKey
  ? createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;

async function authenticate(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(500).json({
      error: "Supabase chưa được cấu hình. Hãy tạo .env từ .env.example."
    });
  }

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return res.status(401).json({ error: "Bạn cần đăng nhập trước." });
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn." });
    }
    req.user = data.user;
    return next();
  } catch (error) {
    console.error("[auth]", error.message);
    return res.status(401).json({ error: "Không xác thực được người dùng." });
  }
}

// Read the signed-in user's saved app data.
router.get("/data", authenticate, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("bloom_user_data")
      .select("user_id, app_data, updated_at")
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (error) {
      console.error("[read]", error.message);
      return res.status(500).json({ error: "Không tải được dữ liệu." });
    }

    return res.json({
      data: data?.app_data || {},
      updatedAt: data?.updated_at || null
    });
  } catch (error) {
    console.error("[read]", error.message);
    return res.status(500).json({ error: "Lỗi máy chủ khi tải dữ liệu." });
  }
});

// Save the signed-in user's app data as JSON.
router.put("/data", authenticate, async (req, res) => {
  const appData = req.body?.data;
  if (!appData || typeof appData !== "object" || Array.isArray(appData)) {
    return res.status(400).json({ error: "Trường data phải là một JSON object." });
  }

  let safeData;
  try {
    safeData = JSON.parse(JSON.stringify(appData));
  } catch {
    return res.status(400).json({ error: "Dữ liệu không thể chuyển thành JSON." });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("bloom_user_data")
      .upsert({
        user_id: req.user.id,
        app_data: safeData,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id" })
      .select("user_id, app_data, updated_at")
      .single();

    if (error) {
      console.error("[write]", error.message);
      return res.status(500).json({ error: "Không lưu được dữ liệu." });
    }

    return res.json({
      message: "Đã lưu dữ liệu.",
      data: data.app_data,
      updatedAt: data.updated_at
    });
  } catch (error) {
    console.error("[write]", error.message);
    return res.status(500).json({ error: "Lỗi máy chủ khi lưu dữ liệu." });
  }
});

module.exports = router;
