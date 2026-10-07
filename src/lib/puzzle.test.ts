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

describe('diffPuzzles — 导入差异预览', () => {
  it('只改一格提示时精确定位为修改', () => {
    const current = p((x) => {
      x.givens[10] = 3;
      x.thermometers = [{ path: [rc(0, 0), rc(0, 1)] }];
    });
    const incoming = clonePuzzle(current);
    incoming.givens[10] = 8;

    const diff = diffPuzzles(current, incoming);
    expect(diff.givens).toEqual([{ cell: 10, type: 'modified', before: 3, after: 8 }]);
    expect(diff.regions).toEqual([]);
    expect(diff.thermometers).toEqual([]);
    expect(diff.modifiedCells).toEqual([10]);
    expect(diff.addedCells).toEqual([]);
    expect(diff.removedCells).toEqual([]);
  });

  it('区分提示新增/删除与宫区归属修改', () => {
    const current = p((x) => {
      x.givens[0] = 5;
      x.regions[1] = 0;
    });
    const incoming = p((x) => {
      x.givens[1] = 7;
      x.regions[1] = 1;
    });
    // 手工保证两题结构均合法，仅比较差异本身
    const fixed = clonePuzzle(incoming);
    fixed.regions[1] = 1;
    fixed.regions[3] = 0;

    const diff = diffPuzzles(current, fixed);
    expect(diff.givens).toContainEqual({ cell: 0, type: 'removed', before: 5, after: 0 });
    expect(diff.givens).toContainEqual({ cell: 1, type: 'added', before: 0, after: 7 });
    expect(diff.regions).toContainEqual({ cell: 1, type: 'modified', before: 0, after: 1 });
    expect(diff.regions).toContainEqual({ cell: 3, type: 'modified', before: 1, after: 0 });
    expect(diff.removedCells).toContain(0);
    expect(diff.addedCells).toContain(1);
  });

  it('比较温度计路径的新增、删除和修改', () => {
    const current = p((x) => {
      x.thermometers = [
        { path: [rc(0, 0), rc(0, 1)] },
        { path: [rc(2, 0), rc(2, 1)] }
      ];
    });
    const incoming = p((x) => {
      x.thermometers = [
        { path: [rc(0, 0), rc(0, 1)] },
        { path: [rc(2, 0), rc(3, 0)] }
      ];
    });

    const diff = diffPuzzles(current, incoming);
    expect(diff.thermometers).toHaveLength(1);
    expect(diff.thermometers[0].type).toBe('modified');
    expect(diff.thermometers[0].beforePath).toEqual([rc(2, 0), rc(2, 1)]);
    expect(diff.thermometers[0].afterPath).toEqual([rc(2, 0), rc(3, 0)]);
    expect(diff.modifiedCells).toEqual(expect.arrayContaining([rc(2, 0), rc(2, 1), rc(3, 0)]));
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
});
