import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  listLayeredSkills,
  listSkills,
  loadSkillContent,
  resolveSkillLayers
} from "./index.js";

async function writeSkill(root: string, id: string, description: string, body = "") {
  const dir = path.join(root, id);
  await mkdir(dir, { recursive: true });
  const content = `---\nname: ${id}\ndescription: ${description}\nwhen_to_use: 用 ${id} 的时候\n---\n\n${body || `# ${id}`}\n`;
  await writeFile(path.join(dir, "SKILL.md"), content, "utf8");
}

async function tempLayerDir() {
  return mkdtemp(path.join(os.tmpdir(), "workhub-skills-layer-"));
}

async function makeThreeLayers() {
  const projectRoot = await tempLayerDir();
  const userRoot = await tempLayerDir();
  const bundledRoot = await tempLayerDir();
  return {
    roots: { projectRoot, userRoot, bundledRoot },
    cleanup: async () => {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(userRoot, { recursive: true, force: true });
      await rm(bundledRoot, { recursive: true, force: true });
    }
  };
}

test("listLayeredSkills merges three layers with project > user > bundled precedence", async () => {
  const { roots, cleanup } = await makeThreeLayers();
  try {
    // 同 id 三层都有：项目级应胜出；user-only / bundled-only 各归其层。
    await writeSkill(roots.projectRoot, "shared-skill", "项目级版本", "project body");
    await writeSkill(roots.userRoot, "shared-skill", "用户级版本", "user body");
    await writeSkill(roots.bundledRoot, "shared-skill", "内置版本", "bundled body");
    await writeSkill(roots.userRoot, "user-only", "仅用户级", "user only body");
    await writeSkill(roots.bundledRoot, "bundled-only", "仅内置", "bundled only body");

    const skills = listLayeredSkills(roots);
    assert.deepEqual(
      skills.map((skill) => skill.id),
      ["bundled-only", "shared-skill", "user-only"]
    );
    const shared = skills.find((skill) => skill.id === "shared-skill");
    assert.equal(shared?.description, "项目级版本");
    assert.equal(shared?.layer, "project");
    assert.equal(shared?.rank, 100);
    assert.equal(skills.find((skill) => skill.id === "user-only")?.layer, "user");
    assert.equal(skills.find((skill) => skill.id === "user-only")?.rank, 200);
    assert.equal(skills.find((skill) => skill.id === "bundled-only")?.layer, "bundled");
    assert.equal(skills.find((skill) => skill.id === "bundled-only")?.rank, 600);

    // loadSkillContent 分层解析：同 id 取最高层内容。
    assert.equal(loadSkillContent("shared-skill", roots)?.includes("project body"), true);
    assert.equal(loadSkillContent("user-only", roots)?.includes("user only body"), true);
    assert.equal(loadSkillContent("bundled-only", roots)?.includes("bundled only body"), true);
  } finally {
    await cleanup();
  }
});

test("user layer overrides bundled for the same id", async () => {
  const { roots, cleanup } = await makeThreeLayers();
  try {
    await writeSkill(roots.userRoot, "dup", "用户级版本", "user wins");
    await writeSkill(roots.bundledRoot, "dup", "内置版本", "bundled loses");
    const skills = listLayeredSkills(roots);
    const dup = skills.find((skill) => skill.id === "dup");
    assert.equal(dup?.description, "用户级版本");
    assert.equal(dup?.layer, "user");
    assert.equal(loadSkillContent("dup", roots)?.includes("user wins"), true);
  } finally {
    await cleanup();
  }
});

test("missing layers degrade gracefully", async () => {
  const { roots, cleanup } = await makeThreeLayers();
  try {
    const missing = path.join(roots.projectRoot, "does-not-exist");
    await writeSkill(roots.bundledRoot, "only-bundled", "仅内置", "body");
    const skills = listLayeredSkills({
      projectRoot: missing,
      userRoot: missing,
      bundledRoot: roots.bundledRoot
    });
    assert.deepEqual(
      skills.map((skill) => skill.id),
      ["only-bundled"]
    );
    assert.equal(skills[0]?.layer, "bundled");
    assert.equal(loadSkillContent("only-bundled", { projectRoot: missing, userRoot: missing, bundledRoot: roots.bundledRoot })?.includes("body"), true);
    // 三层全缺 → 空列表而非抛错。
    assert.deepEqual(listLayeredSkills({ projectRoot: missing, userRoot: missing, bundledRoot: missing }), []);
  } finally {
    await cleanup();
  }
});

test("loadSkillContent rejects illegal ids in layered mode", async () => {
  const { roots, cleanup } = await makeThreeLayers();
  try {
    await writeSkill(roots.projectRoot, "legit", "合法", "body");
    assert.equal(loadSkillContent("../secrets", roots), undefined);
    assert.equal(loadSkillContent("BAD ID", roots), undefined);
    assert.equal(loadSkillContent("", roots), undefined);
    // 合法但不存在的 id → undefined。
    assert.equal(loadSkillContent("no-such-skill", roots), undefined);
  } finally {
    await cleanup();
  }
});

test("layered cache is keyed by layer combination and does not leak across combos", async () => {
  const a = await makeThreeLayers();
  const b = await makeThreeLayers();
  try {
    await writeSkill(a.roots.bundledRoot, "skill-a", "A 组合", "a body");
    await writeSkill(b.roots.bundledRoot, "skill-b", "B 组合", "b body");

    const first = listLayeredSkills(a.roots);
    assert.deepEqual(first.map((skill) => skill.id), ["skill-a"]);
    // 同组合命中缓存（同一引用），不受另一组合影响。
    assert.equal(listLayeredSkills(a.roots), first);
    const second = listLayeredSkills(b.roots);
    assert.deepEqual(second.map((skill) => skill.id), ["skill-b"]);
    assert.notEqual(second, first);
    // 再查 A 组合仍是缓存结果，未串入 B 的技能。
    assert.deepEqual(listLayeredSkills(a.roots).map((skill) => skill.id), ["skill-a"]);

    // 单层 listSkills 对自定义根不缓存：文件系统新增技能后立即可见，
    // 但 listLayeredSkills 的组合缓存保证结果稳定（与 listSkills 默认根缓存语义一致）。
    await writeSkill(a.roots.bundledRoot, "skill-a2", "A 新增", "a2 body");
    assert.equal(listSkills(a.roots.bundledRoot).some((skill) => skill.id === "skill-a2"), true);
    assert.equal(listLayeredSkills(a.roots).some((skill) => skill.id === "skill-a2"), false);
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
});

test("env vars override default project/user skill dirs", async () => {
  const { roots, cleanup } = await makeThreeLayers();
  const prevProject = process.env.WORKHUB_SKILLS_PROJECT_DIR;
  const prevUser = process.env.WORKHUB_SKILLS_USER_DIR;
  try {
    await writeSkill(roots.projectRoot, "env-project", "env 项目级", "env project body");
    await writeSkill(roots.userRoot, "env-user", "env 用户级", "env user body");
    process.env.WORKHUB_SKILLS_PROJECT_DIR = roots.projectRoot;
    process.env.WORKHUB_SKILLS_USER_DIR = roots.userRoot;

    const layers = resolveSkillLayers({ bundledRoot: roots.bundledRoot });
    assert.equal(layers.find((layer) => layer.layer === "project")?.root, roots.projectRoot);
    assert.equal(layers.find((layer) => layer.layer === "user")?.root, roots.userRoot);

    const skills = listLayeredSkills({ bundledRoot: roots.bundledRoot });
    const ids = skills.map((skill) => skill.id);
    assert.equal(ids.includes("env-project"), true);
    assert.equal(ids.includes("env-user"), true);
    assert.equal(loadSkillContent("env-project", { bundledRoot: roots.bundledRoot })?.includes("env project body"), true);

    // 显式 options 优先于 env。
    const explicit = resolveSkillLayers({ projectRoot: "/explicit/project", bundledRoot: roots.bundledRoot });
    assert.equal(explicit.find((layer) => layer.layer === "project")?.root, "/explicit/project");
  } finally {
    if (prevProject === undefined) {
      delete process.env.WORKHUB_SKILLS_PROJECT_DIR;
    } else {
      process.env.WORKHUB_SKILLS_PROJECT_DIR = prevProject;
    }
    if (prevUser === undefined) {
      delete process.env.WORKHUB_SKILLS_USER_DIR;
    } else {
      process.env.WORKHUB_SKILLS_USER_DIR = prevUser;
    }
    await cleanup();
  }
});
