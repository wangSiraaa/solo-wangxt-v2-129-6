// 全局应用状态（Svelte 5 runes）。
import {
  clonePuzzle,
  diffPuzzles,
  importPuzzle,
  puzzleFingerprint,
  validateStructure,
  type Puzzle,
  type PuzzleDiff,
  type StructuralIssue
} from './puzzle';
import type { SolveResult } from './solver';
import { initZ3Api } from './z3-init';
import type { Z3HighLevel } from 'z3-solver';
import { draftFromPuzzle, loadDraft, saveDraft } from './storage';

export type Tool = 'givens' | 'regions' | 'thermo-start' | 'thermo-extend' | 'erase';

export interface AnalysisState {
  status: 'idle' | 'checking' | 'done';
  result: SolveResult | null;
  /** 该结论对应的题面指纹 */
  fingerprint: string | null;
  error: string | null;
}

/** 一次待确认的导入：解析通过的新题面 + 与当前草稿的差异 */
export interface ImportPreviewState {
  /** 经结构校验的导入题面（尚未替换当前草稿） */
  puzzle: Puzzle;
  diff: PuzzleDiff;
}

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveState {
  status: AutosaveStatus;
  message: string;
  at: number | null;
}

export class EditorState {
  puzzle = $state<Puzzle>(null as unknown as Puzzle);
  tool = $state<Tool>('givens');
  /** 当前选中的宫编号（regions 工具） */
  selectedRegion = $state<number>(0);
  /** 正在绘制/编辑的温度计序号 */
  activeThermo = $state<number | null>(null);
  /** 当前草稿 id；null 表示尚未保存的新稿 */
  draftId = $state<string | null>(null);
  draftName = $state<string>('未命名题稿');
  issues = $state<StructuralIssue[]>([]);
  analysis = $state<AnalysisState>({ status: 'idle', result: null, fingerprint: null, error: null });
  z3 = $state<Z3HighLevel | null>(null);
  z3Loading = $state<boolean>(true);
  z3Error = $state<string | null>(null);
  timeoutMs = $state<number>(5000);
  /** 画布高亮的格子（结构错误 / 矛盾核） */
  highlightCells = $state<Set<number>>(new Set());
  showSolution = $state<boolean>(false);
  /** 当前选中格（givens 工具下由数字键/数字盘写入） */
  selectedCell = $state<number | null>(null);
  /** 导入差异预览：非 null 时画布显示差异高亮，草稿尚未被替换 */
  importPreview = $state<ImportPreviewState | null>(null);
  /** 确认导入后的自动保存状态 */
  autosave = $state<AutosaveState>({ status: 'idle', message: '', at: null });
  /** 草稿列表版本号：自动保存后自增，供题稿面板刷新 */
  draftsVersion = $state<number>(0);
  /** 进入预览前的画布高亮，取消时还原 */
  #highlightBeforePreview: Set<number> | null = null;

  #analyzePuzzle: typeof import('./solver').analyzePuzzle | null = null;

  init(puzzle: Puzzle, draftId: string | null, name: string) {
    this.puzzle = puzzle;
    this.draftId = draftId;
    this.draftName = name;
    this.revalidate();
    this.analysis = { status: 'idle', result: null, fingerprint: null, error: null };
  }

  /**
   * 解析并结构校验导入数据，生成与当前草稿的差异预览。
   * 不改动当前草稿：非法题面抛错，画布上仍是原草稿，可继续编辑。
   * 导入文件只允许携带题面层（regions/givens/thermometers），
   * solution/witness/lastCheck/私有批注等字段一律忽略（importPuzzle 白名单读取）。
   */
  previewImport(data: unknown): ImportPreviewState {
    const candidate = importPuzzle(data);
    const diff = diffPuzzles(this.puzzle as Puzzle, candidate);
    this.#highlightBeforePreview = this.highlightCells;
    this.importPreview = { puzzle: candidate, diff };
    // 预览期间清掉旧的错误/矛盾核高亮，差异高亮接管画布
    this.highlightCells = new Set();
    return this.importPreview;
  }

  /**
   * 确认导入：用预览题面替换当前草稿。
   * 指纹必然变化（差异非空）→ revalidate 使旧"唯一解"结论失效为"未检查"；
   * 随后自动保存为新的本地题稿。差异为空时不替换、不失效、不保存。
   */
  async confirmImport(): Promise<void> {
    const preview = this.importPreview;
    if (!preview) return;
    if (!preview.diff.isEmpty) {
      this.puzzle = clonePuzzle(preview.puzzle);
      this.draftId = null; // 导入即新稿，不覆盖旧草稿记录
      if (!this.draftName || this.draftName === '未命名题稿') this.draftName = '导入的题面';
      this.activeThermo = null;
      this.showSolution = false;
      this.revalidate(); // 结构校验 + 指纹比对：旧结论复位为未检查
    }
    this.importPreview = null;
    this.highlightCells = new Set();
    this.#highlightBeforePreview = null;
    if (!preview.diff.isEmpty) await this.#autosave();
  }

  /** 取消导入：草稿一个字节都不变（连检查结论/高亮也恢复原样） */
  cancelImport() {
    this.importPreview = null;
    if (this.#highlightBeforePreview) {
      this.highlightCells = this.#highlightBeforePreview;
      this.#highlightBeforePreview = null;
    }
  }

  /** 题面确认替换后的自动保存（只写本地 IndexedDB；导出仍不带答案层） */
  async #autosave(): Promise<void> {
    if (typeof indexedDB === 'undefined') return; // 测试环境无 IndexedDB
    this.autosave = { status: 'saving', message: '导入后自动保存中…', at: null };
    try {
      const fp = puzzleFingerprint(this.puzzle as Puzzle);
      let id = this.draftId;
      if (!id) {
        const rec = draftFromPuzzle(this.draftName, this.puzzle as Puzzle);
        rec.lastCheck = this.analysis.result;
        rec.checkFingerprint = this.analysis.status === 'done' ? fp : null;
        await saveDraft(rec);
        id = rec.id;
        this.draftId = id;
      } else {
        const existing = (await loadDraft(id)) ?? draftFromPuzzle(this.draftName, this.puzzle as Puzzle);
        existing.name = this.draftName;
        existing.updatedAt = Date.now();
        existing.puzzle = structuredClone(this.puzzle);
        existing.lastCheck = this.analysis.result;
        existing.checkFingerprint = this.analysis.status === 'done' ? fp : null;
        await saveDraft(existing);
      }
      this.autosave = {
        status: 'saved',
        message: `已自动保存为本地题稿「${this.draftName}」`,
        at: Date.now()
      };
      this.draftsVersion++;
    } catch (e) {
      this.autosave = {
        status: 'error',
        message: '自动保存失败：' + (e instanceof Error ? e.message : String(e)),
        at: Date.now()
      };
    }
  }

  async loadZ3() {
    try {
      this.z3 = await initZ3Api();
      const mod = await import('./solver');
      this.#analyzePuzzle = mod.analyzePuzzle;
      this.z3Loading = false;
    } catch (e) {
      this.z3Error = e instanceof Error ? e.message : String(e);
      this.z3Loading = false;
    }
  }

  /** 题面每次改动后：重新结构校验，并判定旧检查结论是否过期 */
  revalidate() {
    this.issues = validateStructure(this.puzzle);
    const fp = puzzleFingerprint(this.puzzle);
    if (this.analysis.result && this.analysis.fingerprint !== fp) {
      // 改了一个提示（或任何题面要素）后，旧结论立即失效
      this.analysis = { status: 'idle', result: null, fingerprint: null, error: null };
    }
  }

  #mutate(fn: (p: Puzzle) => void) {
    // 导入差异预览待确认期间，冻结对当前草稿的一切编辑
    if (this.importPreview) return;
    const draft = clonePuzzle(this.puzzle as Puzzle);
    fn(draft);
    this.puzzle = draft;
    this.revalidate();
  }

  setGiven(cell: number, digit: number) {
    this.#mutate((p) => {
      p.givens[cell] = p.givens[cell] === digit ? 0 : digit;
    });
  }

  clearCell(cell: number) {
    this.#mutate((p) => {
      p.givens[cell] = 0;
    });
  }

  paintRegion(cell: number) {
    this.#mutate((p) => {
      p.regions[cell] = this.selectedRegion;
    });
  }

  startThermo(cell: number) {
    this.#mutate((p) => {
      p.thermometers.push({ path: [cell] });
      this.activeThermo = p.thermometers.length - 1;
    });
  }

  extendThermo(cell: number) {
    if (this.activeThermo === null) return;
    const t = (this.puzzle as Puzzle).thermometers[this.activeThermo];
    if (!t) return;
    // 合法性由结构校验统一报告；这里只做最小的编辑约束
    const last = t.path[t.path.length - 1];
    if (cell === last) {
      // 再次点击末端：完成绘制
      this.finishThermo();
      return;
    }
    this.#mutate((p) => {
      const cur = p.thermometers[this.activeThermo!];
      // 撤销一步
      if (t.path.length >= 2 && cell === t.path[t.path.length - 2]) {
        cur.path.pop();
        return;
      }
      cur.path.push(cell);
    });
  }

  finishThermo() {
    // 丢弃长度不足 2 的温度计
    this.#mutate((p) => {
      p.thermometers = p.thermometers.filter((t) => t.path.length >= 2);
    });
    this.activeThermo = null;
  }

  cancelThermo() {
    this.#mutate((p) => {
      if (this.activeThermo !== null) p.thermometers.splice(this.activeThermo, 1);
    });
    this.activeThermo = null;
  }

  selectThermo(index: number | null) {
    this.activeThermo = index;
  }

  deleteThermo(index: number) {
    this.#mutate((p) => {
      p.thermometers.splice(index, 1);
    });
    if (this.activeThermo === index) this.activeThermo = null;
  }

  /** 画布点击入口，由当前工具决定行为 */
  onCellClick(cell: number) {
    switch (this.tool) {
      case 'regions':
        this.paintRegion(cell);
        break;
      case 'erase':
        this.clearCell(cell);
        this.selectedCell = cell;
        break;
      case 'thermo-start':
        this.startThermo(cell);
        this.tool = 'thermo-extend';
        break;
      case 'thermo-extend':
        this.extendThermo(cell);
        break;
      case 'givens':
      default:
        this.selectedCell = cell;
        break;
    }
  }

  pressDigit(d: number) {
    if (this.tool !== 'givens') return;
    if (this.selectedCell === null) return;
    if (d === 0) this.clearCell(this.selectedCell);
    else this.setGiven(this.selectedCell, d);
  }

  async runCheck() {
    if (!this.z3 || !this.#analyzePuzzle || this.analysis.status === 'checking') return;
    this.analysis.status = 'checking';
    this.analysis.error = null;
    try {
      const result = await this.#analyzePuzzle(
        this.z3,
        this.puzzle as Puzzle,
        this.issues,
        this.timeoutMs
      );
      this.analysis = {
        status: 'done',
        result,
        fingerprint: puzzleFingerprint(this.puzzle as Puzzle),
        error: null
      };
      // 矛盾时高亮冲突约束涉及的格子
      const cells = new Set<number>();
      result.conflict?.forEach((c) => c.cells.forEach((i) => cells.add(i)));
      this.issues.forEach((i) => i.cells.forEach((c) => cells.add(c)));
      this.highlightCells = cells;
    } catch (e) {
      this.analysis.error = e instanceof Error ? e.message : String(e);
      this.analysis.status = 'idle';
    }
  }
}

export const editor = new EditorState();
