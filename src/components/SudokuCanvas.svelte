<script lang="ts">
  import { editor } from '../lib/state.svelte';
  import { CELL_COUNT, N, colOf, rowOf, type CellIndex } from '../lib/puzzle';

  let canvas: HTMLCanvasElement;
  const CELL = 56; // CSS 像素/格
  const SIZE = CELL * N;
  let hover = $state<number | null>(null);
  let dpr = $state(1);

  // 9 个低饱和宫色
  const REGION_COLORS = [
    '#cfe3ff', '#d9f2d1', '#ffe2c2', '#f6d6d6', '#e6d8f5',
    '#c9f0ee', '#f2efcf', '#d6e4f5', '#f5d9ea'
  ];

  // 设备像素比变化时重设画布尺寸
  $effect(() => {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    canvas.style.width = SIZE + 'px';
    canvas.style.height = SIZE + 'px';
  });

  // 订阅任意会影响绘制的状态（在 draw 中读取即建立依赖）
  const tick = $derived.by(() => {
    void editor.puzzle;
    void editor.tool;
    void editor.activeThermo;
    void editor.highlightCells;
    void editor.showSolution;
    void editor.analysis;
    void editor.selectedCell;
    void editor.importPreview;
    void hover;
    void dpr;
    return 1;
  });

  $effect(() => {
    void tick;
    draw();
  });

  function center(i: CellIndex): [number, number] {
    return [colOf(i) * CELL + CELL / 2, rowOf(i) * CELL + CELL / 2];
  }

  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    const p = editor.puzzle;
    if (!p) return;
    const preview = editor.importPreview;
    const regionsView = preview ? preview.puzzle.regions : p.regions;

    // 1) 宫底色（预览时按导入题面的宫区归属着色）
    for (let i = 0; i < CELL_COUNT; i++) {
      const r = rowOf(i), c = colOf(i);
      ctx.fillStyle = REGION_COLORS[regionsView[i] % REGION_COLORS.length];
      ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    }

    // 2) 高亮格（结构错误 / 矛盾核）
    ctx.fillStyle = 'rgba(220, 38, 38, 0.22)';
    editor.highlightCells.forEach((i) => {
      ctx.fillRect(colOf(i) * CELL, rowOf(i) * CELL, CELL, CELL);
    });

    // 2b) 导入差异预览高亮：绿=新增 红=删除 琥珀=修改
    if (preview) {
      fillCells(preview.diff.addedCells, 'rgba(22, 163, 74, 0.30)');
      fillCells(preview.diff.removedCells, 'rgba(220, 38, 38, 0.30)');
      fillCells(preview.diff.modifiedCells, 'rgba(217, 119, 6, 0.32)');
    }

    // 悬停
    if (hover !== null) {
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(colOf(hover) * CELL, rowOf(hover) * CELL, CELL, CELL);
    }
    // 选中格
    if (editor.selectedCell !== null) {
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 3;
      ctx.strokeRect(
        colOf(editor.selectedCell) * CELL + 1.5,
        rowOf(editor.selectedCell) * CELL + 1.5,
        CELL - 3,
        CELL - 3
      );
    }

    // 3) 温度计（先画线和泡，置于格线之下）
    p.thermometers.forEach((t, ti) => {
      drawThermo(ctx, t.path, ti === editor.activeThermo);
    });

    // 3b) 导入差异中的温度计：删除的标红虚线，新增/修改后的形态标绿虚线
    if (preview) {
      ctx.save();
      ctx.setLineDash([6, 5]);
      for (const td of preview.diff.thermometers) {
        if (td.kind === 'removed') {
          drawThermoOutline(ctx, td.beforePath, 'rgba(220, 38, 38, 0.95)');
        } else if (td.kind === 'added') {
          drawThermoOutline(ctx, td.afterPath, 'rgba(22, 163, 74, 0.95)');
        } else {
          drawThermoOutline(ctx, td.beforePath, 'rgba(220, 38, 38, 0.95)');
          drawThermoOutline(ctx, td.afterPath, 'rgba(22, 163, 74, 0.95)');
        }
      }
      ctx.restore();
    }

    // 4) 格线
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1;
    for (let k = 0; k <= N; k++) {
      ctx.beginPath(); ctx.moveTo(k * CELL + 0.5, 0); ctx.lineTo(k * CELL + 0.5, SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, k * CELL + 0.5); ctx.lineTo(SIZE, k * CELL + 0.5); ctx.stroke();
    }
    // 宫界（粗线）：预览时按导入题面的宫区归属绘制
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < CELL_COUNT; i++) {
      const r = rowOf(i), c = colOf(i);
      const x = c * CELL, y = r * CELL;
      if (r === 0 || regionsView[i] !== regionsView[i - N]) line(ctx, x, y, x + CELL, y);
      if (c === 0 || regionsView[i] !== regionsView[i - 1]) line(ctx, x, y, x, y + CELL);
      if (r === N - 1 || regionsView[i] !== regionsView[i + N]) line(ctx, x + CELL, y, x + CELL, y + CELL);
      if (c === N - 1 || regionsView[i] !== regionsView[i + 1]) line(ctx, x, y + CELL, x + CELL, y + CELL);
    }

    // 5) 提示数字（作者题面）。预览时：删除的旧数字标红删除线，
    //    新增/修改后的数字标绿，修改格角落显示旧值。
    const givensView = preview ? preview.puzzle.givens : p.givens;
    const givenDiffByCell = new Map(preview?.diff.givens.map((d) => [d.cell, d]));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${CELL * 0.62}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = '#111827';
    for (let i = 0; i < CELL_COUNT; i++) {
      const g = givensView[i];
      const d = givenDiffByCell.get(i);
      const [cx, cy] = center(i);
      if (g) {
        if (preview && d && d.kind !== 'removed') ctx.fillStyle = '#15803d';
        else ctx.fillStyle = '#111827';
        ctx.fillText(String(g), cx, cy + 1);
      }
      if (preview && d) {
        if (d.kind === 'removed') {
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 3;
          const w = ctx.measureText(String(d.before)).width;
          ctx.beginPath();
          ctx.moveTo(cx - w / 2, cy);
          ctx.lineTo(cx + w / 2, cy);
          ctx.stroke();
          ctx.fillStyle = '#dc2626';
          ctx.fillText(String(d.before), cx, cy + 1);
        } else if (d.kind === 'modified') {
          ctx.font = `600 ${CELL * 0.26}px ui-sans-serif, system-ui, sans-serif`;
          ctx.fillStyle = '#dc2626';
          ctx.textAlign = 'left';
          ctx.fillText(String(d.before), colOf(i) * CELL + 4, rowOf(i) * CELL + 12);
          ctx.textAlign = 'center';
          ctx.font = `600 ${CELL * 0.62}px ui-sans-serif, system-ui, sans-serif`;
        }
      }
    }

    // 5b) 宫区修改格：角标显示 旧宫号→新宫号
    if (preview && preview.diff.regions.length) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `700 ${CELL * 0.24}px ui-sans-serif, system-ui, sans-serif`;
      for (const rd of preview.diff.regions) {
        const x = colOf(rd.cell) * CELL + CELL - 4;
        const y = rowOf(rd.cell) * CELL + CELL - 5;
        ctx.fillStyle = '#b45309';
        ctx.fillText(`${rd.before + 1}→${rd.after + 1}`, x, y);
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }

    // 6) 解层（仅作者本地查看，不参与导出）
    if (editor.showSolution && editor.analysis.result?.solution) {
      const sol = editor.analysis.result.solution;
      ctx.font = `500 ${CELL * 0.42}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = '#2563eb';
      for (let i = 0; i < CELL_COUNT; i++) {
        if (p.givens[i]) continue;
        const [cx, cy] = center(i);
        ctx.fillText(String(sol[i]), cx, cy + 1);
      }
    }
  }

  function fillCells(cells: number[], style: string) {
    const ctx2 = canvas.getContext('2d')!;
    ctx2.fillStyle = style;
    for (const i of cells) {
      ctx2.fillRect(colOf(i) * CELL, rowOf(i) * CELL, CELL, CELL);
    }
  }

  function drawThermo(ctx2: CanvasRenderingContext2D, path: CellIndex[], active: boolean) {
    ctx2.lineCap = 'round';
    ctx2.lineJoin = 'round';
    // 外管
    ctx2.strokeStyle = active ? '#b45309' : '#374151';
    ctx2.lineWidth = CELL * 0.4;
    beginPathThrough(ctx2, path);
    ctx2.stroke();
    // 内芯
    ctx2.strokeStyle = active ? '#f59e0b' : '#9ca3af';
    ctx2.lineWidth = CELL * 0.26;
    beginPathThrough(ctx2, path);
    ctx2.stroke();
    // bulb（水银泡）在路径首端
    const [bx, by] = center(path[0]);
    ctx2.fillStyle = active ? '#f59e0b' : '#374151';
    ctx2.beginPath();
    ctx2.arc(bx, by, CELL * 0.26, 0, Math.PI * 2);
    ctx2.fill();
    // 顶端小帽
    const [tx, ty] = center(path[path.length - 1]);
    ctx2.fillStyle = active ? '#f59e0b' : '#374151';
    ctx2.beginPath();
    ctx2.arc(tx, ty, CELL * 0.13, 0, Math.PI * 2);
    ctx2.fill();
  }

  /** 差异预览用的温度计虚线轮廓（仅描边 + 两端圆点） */
  function drawThermoOutline(ctx2: CanvasRenderingContext2D, path: CellIndex[], color: string) {
    if (!path.length) return;
    ctx2.lineCap = 'round';
    ctx2.lineJoin = 'round';
    ctx2.strokeStyle = color;
    ctx2.lineWidth = CELL * 0.16;
    beginPathThrough(ctx2, path);
    ctx2.stroke();
    const [bx, by] = center(path[0]);
    ctx2.fillStyle = color;
    ctx2.beginPath();
    ctx2.arc(bx, by, CELL * 0.18, 0, Math.PI * 2);
    ctx2.fill();
  }

  function beginPathThrough(ctx2: CanvasRenderingContext2D, path: CellIndex[]) {
    const [sx, sy] = center(path[0]);
    ctx2.beginPath();
    ctx2.moveTo(sx, sy);
    for (let k = 1; k < path.length; k++) {
      const [x, y] = center(path[k]);
      ctx2.lineTo(x, y);
    }
  }
  function line(ctx2: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
    ctx2.beginPath();
    ctx2.moveTo(x1, y1);
    ctx2.lineTo(x2, y2);
    ctx2.stroke();
  }

  function eventCell(e: MouseEvent): CellIndex | null {
    const rect = canvas.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * N);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * N);
    if (r < 0 || r >= N || c < 0 || c >= N) return null;
    return r * N + c;
  }

  let painting = false;
  function onDown(e: MouseEvent) {
    if (editor.importPreview) return; // 差异预览待确认：画布只读
    const cell = eventCell(e);
    if (cell === null) return;
    painting = true;
    editor.onCellClick(cell);
  }
  function onMove(e: MouseEvent) {
    hover = eventCell(e);
    // 宫区刷色支持拖动
    if (painting && !editor.importPreview && editor.tool === 'regions' && hover !== null) editor.onCellClick(hover);
  }
  function onUp() {
    painting = false;
  }
  function onLeave() {
    hover = null;
    painting = false;
  }
  function onDbl(e: MouseEvent) {
    const cell = eventCell(e);
    if (cell !== null && editor.tool === 'thermo-extend') editor.finishThermo();
  }
</script>

<canvas
  bind:this={canvas}
  role="grid"
  aria-label="数独棋盘"
  onpointerdown={onDown}
  onpointermove={onMove}
  onpointerup={onUp}
  onpointerleave={onLeave}
  ondblclick={onDbl}
></canvas>

<style>
  canvas {
    display: block;
    border-radius: 6px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
    background: #fff;
    cursor: crosshair;
    max-width: 100%;
    touch-action: none;
  }
</style>
