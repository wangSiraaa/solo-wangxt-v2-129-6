import type { Puzzle } from './puzzle';
import { puzzleFingerprint } from './puzzle';
import type { SolveResult } from './solver';
import {
  draftFromPuzzle,
  loadDraft,
  saveDraft,
  type DraftRecord
} from './storage';

export interface CurrentDraftRef {
  id: string | null;
  name: string;
}

/**
 * 把当前题面写回当前草稿；未保存过的题稿会创建一条新记录。
 * 只保存编辑器已有的检查结论；导入文件中的答案/历史/批注永远不会进入这里。
 */
export async function persistEditorDraft(
  draft: CurrentDraftRef,
  puzzle: Puzzle,
  analysis: { status: 'idle' | 'checking' | 'done'; result: SolveResult | null }
): Promise<{ id: string }> {
  const fingerprint = puzzleFingerprint(puzzle);
  const result = analysis.status === 'done' ? analysis.result : null;

  if (draft.id) {
    const existing: DraftRecord = (await loadDraft(draft.id)) ?? draftFromPuzzle(draft.name, puzzle);
    existing.id = draft.id;
    existing.name = draft.name;
    existing.updatedAt = Date.now();
    existing.puzzle = structuredClone(puzzle);
    existing.lastCheck = result;
    existing.checkFingerprint = result ? fingerprint : null;
    await saveDraft(existing);
    return { id: draft.id };
  }

  const record = draftFromPuzzle(draft.name, puzzle);
  record.lastCheck = result;
  record.checkFingerprint = result ? fingerprint : null;
  await saveDraft(record);
  return { id: record.id };
}
