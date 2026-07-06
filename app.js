function toggleSummary() {
    const panel = document.querySelector('.summary-panel');
    const btn = document.getElementById('toggleSummaryBtn');
    if (panel) {
        panel.classList.toggle('collapsed');
        if (btn) {
            const isCollapsed = panel.classList.contains('collapsed');
            btn.innerText = isCollapsed ? '▶' : '◀';
            btn.title = isCollapsed ? 'Expand Summary Panel' : 'Collapse Summary Panel';
        }
    }
}
