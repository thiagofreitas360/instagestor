-- Loops e escalas eram criados com share_to_feed = false, então os Reels saíam só na aba Reels.
-- A fila lê o valor da campanha na hora de publicar: corrigir aqui vale também para jobs já enfileirados.
UPDATE "campaigns" SET "share_to_feed" = true, "updated_at" = now() WHERE "origin" IN ('LOOP', 'SCHEDULE') AND "share_to_feed" = false;
