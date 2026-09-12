-- Linhas gravadas antes do fix em src/db/client.ts têm metadata_json como string JSON escalar; restaura o objeto.
UPDATE "audit_logs" SET "metadata_json" = ("metadata_json" #>> '{}')::jsonb WHERE jsonb_typeof("metadata_json") = 'string';
