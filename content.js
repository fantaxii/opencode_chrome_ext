let selectedText = null;

document.addEventListener('mouseup', (e) => {
  const selection = window.getSelection().toString();
  if (selection && selection.trim()) {
    selectedText = selection.trim();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'c') {
    const selection = window.getSelection().toString();
    if (selection && selection.trim()) {
      selectedText = selection.trim();
    }
  }
});

function getPageContent() {
  const bodyText = document.body.innerText;

  const mainContent = document.querySelector('main')?.innerText ||
                    document.querySelector('article')?.innerText ||
                    document.querySelector('[role="main"]')?.innerText ||
                    document.querySelector('.content')?.innerText ||
                    bodyText;

  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .map(h => h.innerText)
    .join('\n');

  const paragraphs = Array.from(document.querySelectorAll('p'))
    .slice(0, 10)
    .map(p => p.innerText)
    .join('\n');

  return {
    title: document.title,
    url: window.location.href,
    fullText: bodyText,
    mainContent: mainContent,
    headings: headings,
    paragraphs: paragraphs,
    selectedText: selectedText
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'get-page-content') {
    const content = getPageContent();
    sendResponse({ success: true, content });
  }
});
