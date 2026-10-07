import { describe, expect, it } from 'vitest';
import {
  areOrthogonallyAdjacent,
  blankPuzzle,
  clonePuzzle,
  diffPuzzles,
  exportPuzzle,
  importPuzzle,
  rc,
  validateStructure,
  type Puzzle
} from './puzzle';

function p(mut?: (p: Puzzle) => void): Puzzle {
  const x = blankPuzzle();
  mut?.(x);
  return x;
}

describe('validateStructure — 宫区覆盖', () => {
  it('标准 3x3 宫无结构问题', () => {
    expect(validateStructure(blankPuzzle())).toEqual([]);
  });

  it('宫编号越界被检出', () => {
    const issues = validateStructure(p((x) => void (x.regions[0] = 9)));
    expect(issues.some((i) => i.code === 'REGION_ID_OUT_OF_RANGE')).toBe(true);
    expect(issues.some((i) => i.code === 'REGION_UNUSED' || i.code === 'REGION_SIZE')).toBe(true);
  });

  it('宫大小不为 9 被检出（宫区未均匀覆盖）', () => {
    // 把一个格子从宫 0 改划到宫 1
    const issues = validateStructure(
      p((x) => {
        x.regions[0] = 1;
      })
    );
    expect(issues.some((i) => i.code === 'REGION_SIZE')).toBe(true);
  });

  it('不连通的宫被检出', () => {
    // 构造：宫 0 取 (0,0) 和 (0,2) 等不相邻格。交换标准分区中的两格，
    // 使宫 0 被撕开（与对角位置的宫交换，保证断开）。
    const x = blankPuzzle();
    // 宫0: 0..2,9..11,18..20。把 0 与 30（宫4内部）交换
    x.regions[0] = 4;
    x.regions[30] = 0;
    const issues = validateStructure(x);
    expect(issues.some((i) => i.code === 'REGION_DISCONNECTED')).toBe(true);
  });
});

describe('validateStructure — 格子范围', () => {
  it('非法提示值被检出', () => {
    const issues = validateStructure(p((x) => void (x.givens[10] = 10)));
    expect(issues.some((i) => i.code === 'GIVEN_OUT_OF_RANGE')).toBe(true);
  });
  it('负数提示被检出', () => {
    const issues = validateStructure(p((x) => void (x.givens[10] = -1)));
    expect(issues.some((i) => i.code === 'GIVEN_OUT_OF_RANGE')).toBe(true);
  });
});

describe('validateStructure — 温度计自交/邻接/越界', () => {
  it('路径重复格（自交）被检出', () => {
    const issues = validateStructure(
      p((x) => {
        x.thermometers = [{ path: [rc(0, 0), rc(0, 1), rc(0, 0)] }];
      })
    );
    expect(issues.some((i) => i.code === 'THERMO_REPEATED_CELL')).toBe(true);
  });

  it('非正交相邻（跨步）被检出', () => {
    const issues = validateStructure(
      p((x) => {
        x.thermometers = [{ path: [rc(0, 0), rc(0, 2)] }];
      })
    );
    expect(issues.some((i) => i.code === 'THERMO_NON_ADJACENT')).toBe(true);
  });

  it('对角线一步被检出', () => {
    expect(areOrthogonallyAdjacent(rc(0, 0), rc(1, 1))).toBe(false);
    const issues = validateStructure(
      p((x) => {
        x.thermometers = [{ path: [rc(0, 0), rc(1, 1)] }];
      })
    );
    expect(issues.some((i) => i.code === 'THERMO_NON_ADJACENT')).toBe(true);
  });

  it('越界下标被检出', () => {
    const issues = validateStructure(
      p((x) => {
        x.thermometers = [{ path: [rc(0, 0), 99] }];
      })
    );
    expect(issues.some((i) => i.code === 'THERMO_CELL_OUT_OF_RANGE')).toBe(true);
  });

  it('长度不足 2 被检出', () => {
    const issues = validateStructure(
      p((x) => {
        x.thermometers = [{ path: [rc(0, 0)] }];
      })
    );
    expect(issues.some((i) => i.code === 'THERMO_TOO_SHORT')).toBe(true);
  });

  it('合法的弯折温度计通过', () => {
    const issues = validateStructure(
      p((x) => {
        x.thermometers = [{ path: [rc(0, 0), rc(1, 0), rc(1, 1), rc(2, 1)] }];
      })
    );
    expect(issues).toEqual([]);
  });
});

describe('导出不泄露答案层', () => {
  it('exportPuzzle 只含题面字段', () => {
    const x = blankPuzzle();
    x.givens[0] = 5;
    const exported = exportPuzzle(x) as unknown as Record<string, unknown>;
    expect(exported.format).toBe('thermo-jigsaw-sudoku');
    expect(exported.kind).toBe('puzzle');
    expect(exported).not.toHaveProperty('solution');
    expect(exported).not.toHaveProperty('lastCheck');
    expect(exported).not.toHaveProperty('answer');
    expect(Object.keys(exported).sort()).toEqual(
      ['exportedAt', 'format', 'givens', 'kind', 'regions', 'thermometers', 'version'].sort()
    );
  });

  it('导入导出往返一致', () => {
    const x = blankPuzzle();
    x.givens[0] = 5;
    x.thermometers = [{ path: [rc(0, 0), rc(0, 1)] }];
    const back = importPuzzle(exportPuzzle(clonePuzzle(x)));
    expect(back.givens).toEqual(x.givens);
    expect(back.thermometers).toEqual(x.thermometers);
    expect(back.regions).toEqual(x.regions);
  });

  it('非法温度计（自交 + 跨步）导入被拒绝', () => {
    const bad = {
      ...exportPuzzle(blankPuzzle()),
      thermometers: [{ path: [rc(0, 0), rc(0, 2), rc(0, 0)] }]
    };
    expect(() => importPuzzle(bad)).toThrow(/结构不合法/);
  });
});

describe('导入文件不得携带答案层 / 私有状态', () => {
  it('文件里的 solution / witness / lastCheck / 批注字段被忽略', () => {
    const poisoned = {
      ...exportPuzzle(blankPuzzle()),
      solution: new Array(81).fill(9),
      witness: new Array(81).fill(1),
      lastCheck: { verdict: 'unique' },
      checkFingerprint: 'forged',
      notes: '同事的私有批注',
      comments: ['历史检查记录']
    };
    const back = importPuzzle(poisoned as unknown) as Puzzle & Record<string, unknown>;
    expect(back).not.toHaveProperty('solution');
    expect(back).not.toHaveProperty('witness');
    expect(back).not.toHaveProperty('lastCheck');
    expect(back).not.toHaveProperty('checkFingerprint');
    expect(back).not.toHaveProperty('notes');
    expect(Object.keys(back).sort()).toEqual(['givens', 'regions', 'thermometers', 'version'].sort());
  });
});

describe('diffPuzzles — 导入差异预览', () => {
  it('相同题面差异为空', () => {
    const x = blankPuzzle();
    x.givens[0] = 5;
    x.thermometers = [{ path: [rc(0, 0), rc(0, 1)] }];
    const d = diffPuzzles(clonePuzzle(x), clonePuzzle(x));
    expect(d.isEmpty).toBe(true);
    expect(d.cells).toEqual([]);
  });

  it('只改一格提示时精确定位该格（修改/新增/删除三类）', () => {
    const before = blankPuzzle();
    before.givens[10] = 3;
    before.givens[11] = 7;

    const after = blankPuzzle();
    after.givens[10] = 8; // 修改
    after.givens[11] = 7; // 不变
    after.givens[20] = 2; // 新增
    // 11 保持；删除：after.givens[30] 保持 0，before 放一个
    before.givens[30] = 9;

    const d = diffPuzzles(before, after);
    expect(d.givens.map((g) => g.cell).sort((a, b) => a - b)).toEqual([10, 20, 30]);
    expect(d.regions).toEqual([]);
    expect(d.thermometers).toEqual([]);
    expect([...d.cells].sort((a, b) => a - b)).toEqual([10, 20, 30]); // 精确：仅这三格

    const mod = d.givens.find((g) => g.cell === 10)!;
    expect(mod.kind).toBe('modified');
    expect([mod.before, mod.after]).toEqual([3, 8]);
    const add = d.givens.find((g) => g.cell === 20)!;
    expect(add.kind).toBe('added');
    const rm = d.givens.find((g) => g.cell === 30)!;
    expect(rm.kind).toBe('removed');
  });

  it('宫区归属变化按格报告旧/新宫号', () => {
    const before = blankPuzzle();
    const after = blankPuzzle();
    after.regions[40] = 7;
    after.regions[41] = 7;
    const d = diffPuzzles(before, after);
    expect(d.regions.map((r) => r.cell)).toEqual([40, 41]);
    expect(d.regions[0]).toMatchObject({ kind: 'modified', before: before.regions[40], after: 7 });
    expect(d.modifiedCells).toContain(40);
  });

  it('温度计新增/删除/路径修改分别识别', () => {
    const before = blankPuzzle();
    before.thermometers = [
      { path: [rc(0, 0), rc(0, 1)] }, // 会被修改（同 bulb）
      { path: [rc(2, 2), rc(2, 3)] } // 会被删除
    ];
    const after = blankPuzzle();
    after.thermometers = [
      { path: [rc(0, 0), rc(0, 1), rc(0, 2)] }, // 修改
      { path: [rc(4, 4), rc(4, 5)] } // 新增
    ];
    const d = diffPuzzles(before, after);
    const kinds = d.thermometers.map((t) => t.kind).sort();
    expect(kinds).toEqual(['added', 'modified', 'removed']);
    const mod = d.thermometers.find((t) => t.kind === 'modified')!;
    expect(mod.beforePath).toEqual([rc(0, 0), rc(0, 1)]);
    expect(mod.afterPath).toEqual([rc(0, 0), rc(0, 1), rc(0, 2)]);
    // 修改温度计的旧格/新格都进入高亮
    expect(d.modifiedCells).toContain(rc(0, 2));
  });

  it('温度计仅顺序调整（路径不变）不算差异', () => {
    const before = blankPuzzle();
    before.thermometers = [
      { path: [rc(0, 0), rc(0, 1)] },
      { path: [rc(2, 2), rc(2, 3)] }
    ];
    const after = blankPuzzle();
    after.thermometers = [
      { path: [rc(2, 2), rc(2, 3)] },
      { path: [rc(0, 0), rc(0, 1)] }
    ];
    const d = diffPuzzles(before, after);
    expect(d.thermometers).toEqual([]);
  });
});
