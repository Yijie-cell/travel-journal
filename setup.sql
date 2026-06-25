-- ============================================
-- 旅行游记 - Supabase 数据库初始化脚本
-- 在 Supabase SQL Editor 中执行
-- ============================================

-- 1. 创建游记表
CREATE TABLE IF NOT EXISTS entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  date DATE DEFAULT CURRENT_DATE,
  description TEXT DEFAULT '',
  photos TEXT DEFAULT '',       -- base64 图片，多张用 ||| 分隔
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 开启行级安全 (RLS)
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;

-- 3. 允许所有人读取（你和朋友都能看到）
CREATE POLICY "anyone_can_read" ON entries
  FOR SELECT USING (true);

-- 4. 允许所有人添加
CREATE POLICY "anyone_can_insert" ON entries
  FOR INSERT WITH CHECK (true);

-- 5. 允许所有人更新
CREATE POLICY "anyone_can_update" ON entries
  FOR UPDATE USING (true);

-- 6. 允许所有人删除
CREATE POLICY "anyone_can_delete" ON entries
  FOR DELETE USING (true);
