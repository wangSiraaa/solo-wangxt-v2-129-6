<script lang="ts">
  import { editor } from '../lib/state.svelte';
  import { coordLabel, exportPuzzle } from '../lib/puzzle';

  let message = $state('');
  let importOpen = $state(false);
  let importText = $state('');

  const preview = $derived(editor.importPreview);

  function exportJson(): string {
    // 导出题面：exportPuzzle 只含 regions/givens/thermometers，
    // 不含 solution / lastCheck 等作者私有答案层。
    return JSON.stringify(exportPuzzle(editor.puzzle), null, 2);
  }

  function download() {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${editor.draftName || 'puzzle'}.puzzle.json`;
    a.click();
    URL.revokeObjectURL(url);
    message = '已导出题面文件（不含答案层）';
  }

  async function copy() {
    await navigator.clipboard.writeText(exportJson());
    message = '题面 JSON 已复制到剪贴板（不含答案层）';
  }

  /** 第一步：解析 + 结构校验 + 生成差异预览；草稿此时不被触碰 */
  function parseImport() {
    let data: unknown;
    try {
      data = JSON.parse(importText);
    } catch (e) {
      message = '导入失败：JSON 解析错误 — ' + (e instanceof Error ? e.message : String(e));
      return;
    }
    try {
      editor.previewImport(data);
      message = '';
    } catch (e) {
      // 非法（含非法温度计）题面被拒绝：不进入预览，原草稿可继续编辑
      editor.cancelImport();
      message = '导入被拒绝：' + (e instanceof Error ? e.message : String(e));
    }
  }

  /** 第二步（确认）：替换题面 → 指纹失效 → 自动保存 */
  async function confirm() {
    await editor.confirmImport();
    if (!editor.autosave.message) message = '已确认导入';
    else message = editor.autosave.message;
    importOpen = false;
    importText = '';
  }

  /** 第二步（取消）：草稿字节不变 */
  function cancel() {
    editor.cancelImport();
    message = '已取消导入，当前草稿未改动';
    importOpen = false;
    importText = '';
  }

  function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      importText = String(reader.result ?? '');
      importOpen = true;
      parseImport();
    };
    reader.readAsText(file);
    input.value = '';
  }

  function givenText(kind: string, before: number, after: number): string {
    const b = before === 0 ? '空' : String(before);
    const a = after === 0 ? '空' : String(after);
    if (kind === 'added') return `新增提示 ${a}`;
    if (kind === 'removed') return `删除提示 ${b}`;
    return `${b} → ${a}`;
  }
</script>

<div class="panel">
  <h4>题面导入 / 导出</h4>
  <div class="row">
    <button onclick={download}>下载题面 JSON</button>
    <button onclick={copy}>复制题面</button>
    <button class="secondary" onclick={() => (importOpen = !importOpen)}>
      {importOpen ? '收起导入' : '导入题面'}
    </button>
    <label class="file">
      <input type="file" accept="application/json,.json" onchange={onFile} />
      选择文件导入
    </label>
  </div>
  {#if importOpen}
    <textarea bind:value={importText} rows="8" placeholder="粘贴题面 JSON：format 为 thermo-jigsaw-sudoku"></textarea>
    {#if !preview}
      <div>
        <button class="primary" onclick={parseImport}>解析并预览差异</button>
      </div>
    {/if}
  {/if}

  {#if preview}
    {@const d = preview.diff}
    <div class="diff-box">
      <h5>导入差异预览（当前草稿尚未改动）</h5>
      {#if d.isEmpty}
        <p class="msg">导入题面与当前草稿完全一致，无需替换。</p>
      {:else}
        <ul class="legend">
          <li><span class="sw added"></span>新增</li>
          <li><span class="sw removed"></span>删除</li>
          <li><span class="sw modified"></span>修改</li>
        </ul>
        <div class="counts">
          提示 {d.givens.length} 格 · 宫区 {d.regions.length} 格 · 温度计 {d.thermometers.length} 支
        </div>

        {#if d.givens.length}
          <h6>提示数字</h6>
          <ul class="items givens-list">
            {#each d.givens as g (g.cell)}
              <li class={g.kind}>
                <span class="tag">{g.kind === 'added' ? '新增' : g.kind === 'removed' ? '删除' : '修改'}</span>
                {coordLabel(g.cell)}：{givenText(g.kind, g.before, g.after)}
              </li>
            {/each}
          </ul>
        {/if}

        {#if d.regions.length}
          <h6>宫区归属</h6>
          <ul class="items">
            {#each d.regions as r (r.cell)}
              <li class="modified">
                <span class="tag">修改</span>
                {coordLabel(r.cell)}：宫 {r.before + 1} → 宫 {r.after + 1}
              </li>
            {/each}
          </ul>
        {/if}

        {#if d.thermometers.length}
          <h6>温度计</h6>
          <ul class="items">
            {#each d.thermometers as t (String(t.beforeIndex) + '->' + String(t.afterIndex))}
              <li class={t.kind}>
                <span class="tag">{t.kind === 'added' ? '新增' : t.kind === 'removed' ? '删除' : '修改'}</span>
                {#if t.beforeIndex !== null}#{t.beforeIndex + 1}{/if}
                {#if t.kind === 'modified'} → #{(t.afterIndex ?? 0) + 1}{/if}
                <span class="path">
                  {#if t.beforePath.length}[{t.beforePath.map(coordLabel).join(' ')}]{/if}
                  {#if t.kind === 'modified'} → {/if}
                  {#if t.afterPath.length}[{t.afterPath.map(coordLabel).join(' ')}]{/if}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}

      <div class="confirm-row">
        <button class="confirm" onclick={confirm} disabled={d.isEmpty}>确认替换并自动保存</button>
        <button class="cancel" onclick={cancel}>取消（草稿不变）</button>
      </div>
      <p class="note">确认后旧检查结论（含"唯一解"）将失效为"未检查"，需重新检查。</p>
    </div>
  {/if}

  {#if editor.autosave.status !== 'idle' && !preview}
    <p class="msg autosave {editor.autosave.status}">{editor.autosave.message}</p>
  {/if}
  {#if message}<p class="msg">{message}</p>{/if}
  <p class="note">
    导出数据仅包含宫区、提示、温度计（kind:"puzzle"），
    <strong>不包含</strong>作者本地保存的答案、首解与检查结论；
    导入时这些字段即便出现在文件里也会被忽略，不会覆盖本地状态。
  </p>
</div>

<style>
  .panel { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
  h4 { margin: 0 0 8px; font-size: 13px; }
  .row { display: flex; flex-wrap: wrap; gap: 6px; }
  button { border: 1px solid #d1d5db; background: #fff; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 13px; }
  .primary { background: #2563eb; color: #fff; border-color: #2563eb; }
  .secondary { background: #f3f4f6; }
  .file { position: relative; overflow: hidden; border: 1px solid #d1d5db; border-radius: 6px; padding: 6px 10px; font-size: 13px; cursor: pointer; background: #fff; }
  .file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  textarea { width: 100%; box-sizing: border-box; margin-top: 8px; font-family: ui-monospace, monospace; font-size: 12px; border: 1px solid #d1d5db; border-radius: 6px; padding: 8px; }
  .msg { font-size: 12px; color: #2563eb; margin: 8px 0 0; }
  .note { font-size: 11px; color: #6b7280; margin: 8px 0 0; line-height: 1.5; }

  .diff-box { margin-top: 10px; border: 1px solid #fcd34d; background: #fffbeb; border-radius: 8px; padding: 10px; }
  .diff-box h5 { margin: 0 0 6px; font-size: 13px; }
  .diff-box h6 { margin: 8px 0 4px; font-size: 12px; color: #374151; }
  .legend { display: flex; gap: 12px; list-style: none; margin: 0 0 4px; padding: 0; font-size: 12px; }
  .legend .sw { display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
  .sw.added { background: rgba(22, 163, 74, 0.55); }
  .sw.removed { background: rgba(220, 38, 38, 0.55); }
  .sw.modified { background: rgba(217, 119, 6, 0.6); }
  .counts { font-size: 12px; color: #4b5563; margin-bottom: 4px; }
  .items { list-style: none; margin: 0; padding: 0; font-size: 12px; max-height: 180px; overflow: auto; }
  .items li { padding: 2px 0; display: flex; gap: 6px; align-items: baseline; }
  .items .path { color: #6b7280; font-size: 11px; }
  .givens-list { display: block; }
  .tag { flex: none; font-size: 10px; border-radius: 4px; padding: 0 5px; color: #fff; }
  li.added .tag { background: #16a34a; }
  li.removed .tag { background: #dc2626; }
  li.modified .tag { background: #d97706; }
  .confirm-row { display: flex; gap: 8px; margin-top: 10px; }
  .confirm { background: #16a34a; color: #fff; border-color: #16a34a; font-weight: 600; }
  .confirm:disabled { opacity: .55; }
  .cancel { border-color: #dc2626; color: #dc2626; }
  .autosave.saved { color: #166534; }
  .autosave.error { color: #dc2626; }
  .autosave.saving { color: #6b7280; }
</style>
