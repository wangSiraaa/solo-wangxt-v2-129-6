import { describe, expect, it, vi, beforeEach } from 'vitest';

const persistMock = vi.fn();

vi.mock('./autosave', () => ({
  persistEditorDraft: (...args: unknown[]) => persistMock(...args)
}));

import { EditorState } from './state.svelte';
import { standardSample } from './samples';
import { clonePuzzle, exportPuzzle, puzzleFingerprint } from './puzzle';

beforeEach(() => {
  persistMock.mockReset();
  persistMock.mockResolvedValue({ id: 'draft-1' });
});

// 不依赖 Z3：直接验证"题面指纹变化 => 旧结论必须失效"这一状态规则。
describe('改变提示后旧结论失效', () => {
  it('已有结论时修改一个提示，结论立即回到未检查状态', () => {
    const ed = new EditorState();
    ed.init(standardSample(), null, 't');
    const fpBefore = puzzleFingerprint(ed.puzzle);
    // 模拟一次已完成的检查（含首解），并登记其指纹
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
      fingerprint: fpBefore,
      error: null
    };
    expect(ed.analysis.status).toBe('done');

    // 找到一个现有提示并改动它
    const givenCell = ed.puzzle.givens.findIndex((g) => g !== 0);
    expect(givenCell).toBeGreaterThanOrEqual(0);
    const oldVal = ed.puzzle.givens[givenCell];
    ed.setGiven(givenCell, oldVal === 9 ? 8 : oldVal + 1);

    // 旧结论必须失效：不再宣称唯一
    expect(ed.analysis.status).toBe('idle');
    expect(ed.analysis.result).toBeNull();
    expect(ed.analysis.fingerprint).toBeNull();
  });

  it('未产生过结论时修改题面保持空闲，不报错', () => {
    const ed = new EditorState();
    ed.init(standardSample(), null, 't');
    ed.setGiven(0, ed.puzzle.givens[0] ? 1 : 7);
    expect(ed.analysis.status).toBe('idle');
  });

  it('结构问题出现时 issues 被填充', () => {
    const ed = new EditorState();
    ed.init(standardSample(), null, 't');
    // 把温度计最后一格替换成与前一格不相邻的远格，制造结构错误
    const t = ed.puzzle.thermometers[0];
    if (t) {
      const p = standardSample();
      p.thermometers[0].path[t.path.length - 1] = 80;
      ed.init(p, null, 't2');
      expect(ed.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('导入差异预览', () => {
  it('只改一格提示时差异精确定位到该格', async () => {
    const ed = new EditorState();
    ed.init(standardSample(), null, 't');

    const incoming = clonePuzzle(standardSample());
    const cell = incoming.givens.findIndex((g) => g !== 0);
    incoming.givens[cell] = incoming.givens[cell] === 9 ? 8 : 9;

    const diff = ed.prepareImport(exportPuzzle(incoming));
    expect(diff.givens).toHaveLength(1);
    expect(diff.givens[0].cell).toBe(cell);
    expect(diff.regions).toEqual([]);
    expect(diff.thermometers).toEqual([]);
    expect(diff.modifiedCells).toEqual([cell]);

    // 确认前当前草稿字节不变
    expect(ed.puzzle.givens[cell]).not.toBe(incoming.givens[cell]);
    await ed.confirmImport();
    expect(ed.puzzle.givens[cell]).toBe(incoming.givens[cell]);
    expect(ed.importPreview).toBeNull();
  });

  it('非法温度计导入被拒绝、不替换草稿、原草稿可继续编辑', () => {
    const ed = new EditorState();
    ed.init(standardSample(), null, 't');
    const beforeFingerprint = puzzleFingerprint(ed.puzzle);
    const cell = ed.puzzle.givens.findIndex((g) => g !== 0);

    // 先有一个合法预览，再尝试用非法文件替换它
    const valid = clonePuzzle(standardSample());
    valid.givens[cell] = valid.givens[cell] === 9 ? 8 : 9;
    ed.prepareImport(exportPuzzle(valid));
    expect(ed.importPreview).not.toBeNull();

    const invalid = clonePuzzle(standardSample());
    invalid.thermometers.push({ path: [0, 20] }); // 非正交相邻
    expect(() => ed.prepareImport(exportPuzzle(invalid))).toThrow(/结构不合法/);

    expect(ed.importPreview).toBeNull();
    expect(puzzleFingerprint(ed.puzzle)).toBe(beforeFingerprint);
    expect(persistMock).not.toHaveBeenCalled();

    // 原草稿仍可继续编辑
    const editableCell = ed.puzzle.givens[cell] === 0 ? 0 : cell;
    ed.setGiven(editableCell, ed.puzzle.givens[editableCell] === 5 ? 6 : 5);
    expect(ed.issues).toEqual([]);
  });

  it('取消导入时草稿字节与旧结论均不变，且不保存', async () => {
    const ed = new EditorState();
    ed.init(standardSample(), 'existing-draft', 't');
    const before = puzzleFingerprint(ed.puzzle);
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
      fingerprint: before,
      error: null
    };

    const incoming = clonePuzzle(standardSample());
    incoming.givens[0] = 7;
    ed.prepareImport(exportPuzzle(incoming));
    ed.cancelImport();

    expect(puzzleFingerprint(ed.puzzle)).toBe(before);
    expect(ed.analysis.status).toBe('done');
    expect(ed.analysis.result?.verdict).toBe('unique');
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('确认合法导入后旧唯一解结论显示未检查并触发自动保存', async () => {
    const ed = new EditorState();
    ed.init(standardSample(), 'existing-draft', 't');
    const before = puzzleFingerprint(ed.puzzle);
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
      fingerprint: before,
      error: null
    };

    const incoming = clonePuzzle(standardSample());
    incoming.givens[0] = 7;
    const incomingData = {
      ...exportPuzzle(incoming),
      // 这些答案层/历史/私有批注字段必须被忽略，不能覆盖本地状态
      solution: new Array(81).fill(2),
      lastCheck: { verdict: 'unsat' },
      checkFingerprint: 'forged',
      privateNotes: '同事的私有批注'
    };

    ed.prepareImport(incomingData);
    await ed.confirmImport();

    expect(ed.analysis.status).toBe('idle');
    expect(ed.analysis.result).toBeNull();
    expect(ed.analysis.fingerprint).toBeNull();
    expect(persistMock).toHaveBeenCalledTimes(1);
    const [draftRef, savedPuzzle, savedAnalysis] = persistMock.mock.calls[0];
    expect(draftRef).toEqual({ id: 'existing-draft', name: 't' });
    expect(savedPuzzle.givens[0]).toBe(7);
    expect(savedPuzzle).not.toHaveProperty('solution');
    expect(savedPuzzle).not.toHaveProperty('lastCheck');
    expect(savedPuzzle).not.toHaveProperty('privateNotes');
    expect(savedAnalysis.result).toBeNull();
  });
});
