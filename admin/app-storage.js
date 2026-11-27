// Adding a software item publishes its homepage label and app page in one Git commit.
window.WikiAppStorage = (() => {
    const repo = 'https://api.github.com/repos/justintylerm/wiki';
    const serialize = value => JSON.stringify(value, null, 2) + '\n';
    const fileText = file => new TextDecoder().decode(Uint8Array.from(atob(file.content), ch => ch.charCodeAt(0)));

    async function publishWithSoftwareItems({token, pages, labels, revision}) {
        async function request(path, method = 'GET', body) {
            const response = await fetch(repo + path, {
                method, cache: 'no-store',
                headers: {
                    Authorization: 'Bearer ' + token,
                    Accept: 'application/vnd.github+json',
                    'Content-Type': 'application/json',
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                body: body === undefined ? undefined : JSON.stringify(body)
            });
            const result = await response.json();
            if (!response.ok) {
                throw Object.assign(new Error(result.message || 'GitHub request failed (' + response.status + ').'), {status: response.status});
            }
            return result;
        }

        const branchTip = async () => (await request('/branches/main')).commit;
        const appsText = serialize(pages);
        let head = await branchTip();
        for (let attempt = 0; attempt < 3; attempt++) {
            const [appFile, homeFile] = await Promise.all(['apps.json', 'content.json'].map(
                path => request('/contents/' + path + '?ref=' + head.sha)
            ));
            const home = JSON.parse(fileText(homeFile));
            const content = window.WikiSetup.withSoftwareItems(home, labels);
            if (appFile.sha !== revision) {
                // A previous publish can succeed even if its response never reached the browser.
                if (fileText(appFile) === appsText && serialize(home) === serialize(content)) {
                    return {revision: appFile.sha, content};
                }
                throw new Error('Another editor saved app changes. Copy your edits and reload before publishing.');
            }

            const tree = await request('/git/trees', 'POST', {
                base_tree: head.commit.tree.sha,
                tree: [
                    {path: 'apps.json', mode: '100644', type: 'blob', content: appsText},
                    {path: 'content.json', mode: '100644', type: 'blob', content: serialize(content)}
                ]
            });
            const nextRevision = tree.tree.find(entry => entry.path === 'apps.json')?.sha;
            if (!nextRevision) throw new Error('GitHub did not return the saved app file.');
            const commit = await request('/git/commits', 'POST', {
                message: 'Publish app page and software setup item', tree: tree.sha, parents: [head.sha]
            });
            try {
                await request('/git/refs/heads/main', 'PATCH', {sha: commit.sha, force: false});
                return {revision: nextRevision, content};
            } catch (error) {
                if (error.status && error.status !== 409 && error.status !== 422) throw error;
                const latest = await branchTip();
                if (latest.sha === commit.sha) return {revision: nextRevision, content};
                if (latest.sha === head.sha) throw error;
                // Reapply against the new tip, including any concurrent homepage edits.
                head = latest;
            }
        }
        throw new Error('The site changed during publishing. Please try saving again.');
    }

    return {publishWithSoftwareItems};
})();
