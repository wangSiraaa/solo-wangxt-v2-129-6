import { describe, expect, it } from 'vitest';
import { EditorState } from './state.svelte';
import { standardSample } from './samples';
import { blankPuzzle, clonePuzzle, exportPuzzle, puzzleFingerprint, rc } from './puzzle';

function edWithUniqueConclusion(): EditorState {
  const ed = new EditorState();
  ed.init(standardSample(), null, 't');
  // 模拟一次"唯一解"检查结论
  ed.analysis = {
    status: 'done',
    result: {
      verdict: 'unique',
      solution: new Array(81).fill(1),
      witness: null,
      conflict: [],
      reason: null,
      elapsedMs: 1
    },
    fingerprint: puzzleFingerprint(ed.puzzle),
    error: null
  };
  return ed;
}

function withOneGivenChanged() {
  const p = standardSample();
  const cell = p.givens.findIndex((g) => g !== 0);
  const oldVal = p.givens[cell];
  p.givens[cell] = oldVal === 9 ? 8 : oldVal + 1;
  return { payload: exportPuzzle(p), cell };
}

describe('导入差异预览流程', () => {
  it('预览阶段不改草稿；差异精确定位被修改的那一格', () => {
    const ed = new EditorState();
    ed.init(standardSample(), null, 't');
    const snapshot = JSON.stringify(ed.puzzle);
    const { payload, cell } = withOneGivenChanged();

    const preview = ed.previewImport(payload);

    // 草稿字节不变
    expect(JSON.stringify(ed.puzzle)).toBe(snapshot);
    // 差异只有一格提示修改
    expect(preview.diff.givens).toHaveLength(1);
    expect(preview.diff.givens[0].cell).toBe(cell);
    expect(preview.diff.givens[0].kind).toBe('modified');
    expect(preview.diff.regions).toEqual([]);
    expect(preview.diff.thermometers).toEqual([]);
    expect(preview.diff.cells).toEqual([cell]);
  });

  it('取消导入：草稿与旧结论原样保留', () => {
    const ed = edWithUniqueConclusion();
    const snapshot = JSON.stringify(ed.puzzle);
    ed.previewImport(withOneGivenChanged().payload);

    ed.cancelImport();

    expect(JSON.stringify(ed.puzzle)).toBe(snapshot);
    expect(ed.importPreview).toBeNull();
    expect(ed.analysis.status).toBe('done');
    expect(ed.analysis.result?.verdict).toBe('unique');
  });

  it('非法温度计导入被拒绝：抛错、不进入预览、原草稿可继续编辑', () => {
    const ed = new EditorState();
    ed.init(standardSample(), null, 't');
    const snapshot = JSON.stringify(ed.puzzle);
    const bad = {
      ...exportPuzzle(blankPuzzle()),
      thermometers: [{ path: [rc(0, 0), rc(0, 2)] }] // 跨步
    };

    expect(() => ed.previewImport(bad)).toThrow(/结构不合法/);
    expect(ed.importPreview).toBeNull();
    expect(JSON.stringify(ed.puzzle)).toBe(snapshot);

    // 原草稿仍可编辑
    const target = ed.puzzle.givens.findIndex((g) => g === 0);
    ed.setGiven(target, 4);
    expect(ed.puzzle.givens[target]).toBe(4);
  });

  it('确认合法导入：题面被替换，旧"唯一解"结论显示未检查（指纹失效）', async () => {
    const ed = edWithUniqueConclusion();
    const { payload, cell } = withOneGivenChanged();
    ed.previewImport(payload);

    await ed.confirmImport();

    expect(ed.importPreview).toBeNull();
    expect(ed.puzzle.givens[cell]).toBe(payload.givens[cell]);
    // 旧结论必须失效
    expect(ed.analysis.status).toBe('idle');
    expect(ed.analysis.result).toBeNull();
    expect(ed.analysis.fingerprint).toBeNull();
    // 新草稿结构合法
    expect(ed.issues).toEqual([]);
  });

  it('预览待确认期间编辑被冻结；取消后恢复', () => {
    const ed = new EditorState();
    ed.init(standardSample(), null, 't');
    ed.previewImport(withOneGivenChanged().payload);
    const snapshot = JSON.stringify(ed.puzzle);

    const target = ed.puzzle.givens.findIndex((g) => g === 0);
    ed.setGiven(target, 4);
    ed.paintRegion(0);
    expect(JSON.stringify(ed.puzzle)).toBe(snapshot);

    ed.cancelImport();
    ed.setGiven(target, 4);
    expect(ed.puzzle.givens[target]).toBe(4);
  });

  it('差异为空时确认不做替换、不触发指纹失效', async () => {
    const ed = edWithUniqueConclusion();
    const puzzleBefore = ed.puzzle;
    ed.previewImport(exportPuzzle(clonePuzzle(ed.puzzle)));
    expect(ed.importPreview?.diff.isEmpty).toBe(true);

    await ed.confirmImport();

    expect(ed.puzzle).toBe(puzzleBefore);
    expect(ed.analysis.status).toBe('done');
    expect(ed.analysis.result?.verdict).toBe('unique');
  });

  it('导入文件携带的解/检查历史/批注不会进入题面或结论', () => {
    const ed = edWithUniqueConclusion();
    const poisoned = {
      ...exportPuzzle(blankPuzzle()),
      solution: new Array(81).fill(9),
      lastCheck: { verdict: 'unsat' },
      checkFingerprint: 'forged',
      notes: '私有批注'
    };
    ed.previewImport(poisoned);
    expect((ed.puzzle as unknown as Record<string, unknown>).solution).toBeUndefined();
    // 预览不影响既有结论
    expect(ed.analysis.result?.verdict).toBe('unique');
  });
});
