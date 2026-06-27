-- 真实 agent run 的 snapshot ref 存的是本机绝对路径；macOS 临时目录 + run id 很容易超过 128。
-- 过窄会让写文件前的 snapshot gate 插入失败，进而导致所有 write_file/mkdir/run_command 都失败。
-- 手写 SQL（snapshot 链止于 0015）。
ALTER TABLE "snapshots" ALTER COLUMN "ref" TYPE varchar(1024);
