(function () {
    function setupCategories(content) {
        return content.setupCategories ?? [{ label: 'software', items: content.setup ?? [] }];
    }

    // Keep both the editable grid and the legacy software list in the same order.
    function withSoftwareItems(content, additions) {
        if (!additions.length) return content;
        const categories = [...setupCategories(content)];
        const index = categories.findIndex(category => category.label.trim().toLowerCase() === 'software');
        const software = categories[index] || { label: 'software', items: [] };
        const items = [...software.items];
        const names = new Set(items.map(item => item.trim().toLowerCase()));
        for (const item of additions) {
            const label = item.trim();
            if (label && !names.has(label.toLowerCase())) {
                items.push(label);
                names.add(label.toLowerCase());
            }
        }
        categories[index < 0 ? categories.length : index] = { ...software, items };
        return { ...content, setupCategories: categories, setup: items };
    }

    const api = { setupCategories, withSoftwareItems };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else window.WikiSetup = api;
})();
