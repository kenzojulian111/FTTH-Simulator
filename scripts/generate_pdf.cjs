const WebSocket = require('ws');
const fs = require('fs');
const { spawn } = require('child_process');

async function waitForPort(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // wait
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timeout waiting for browser on port ${port}`);
}

async function main() {
  const port = 9222;
  const profileDir = `/tmp/brave_pdf_profile_${Date.now()}`;

  console.log('Spawning Brave headless on port', port);
  const browserProc = spawn('brave', [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profileDir}`,
    '--disable-gpu',
    'about:blank'
  ], { stdio: 'ignore' });

  browserProc.on('error', (err) => {
    console.error('Failed to spawn browser:', err);
  });

  try {
    const versionData = await waitForPort(port);
    console.log('Browser is up:', versionData.Browser);

    // Create new page target
    const targetRes = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    const targetData = await targetRes.json();
    const pageWsUrl = targetData.webSocketDebuggerUrl;
    console.log('Page WS URL:', pageWsUrl);

    const ws = new WebSocket(pageWsUrl);

    let idCounter = 1;
    const pending = new Map();

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = idCounter++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) {
          reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          resolve(msg.result);
        }
      }
    });

    await new Promise((resolve) => ws.on('open', resolve));
    console.log('Connected to page CDP');

    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');

    await send('Page.navigate', { url: 'http://localhost:5173/' });

    // Wait 3s for initial load
    await new Promise((r) => setTimeout(r, 3000));

    // Set active project in sessionStorage and reload
    await send('Runtime.evaluate', {
      expression: `
        window.sessionStorage.setItem("ftth.activeProjectId", "test-proj-calc-physical-20261031");
        window.location.reload();
      `,
    });

    // Wait 4s for reload and project fetch
    await new Promise((r) => setTimeout(r, 4000));

    // Check current project name
    let checkRes = await send('Runtime.evaluate', {
      expression: `document.querySelector('input[aria-label="Project name"]')?.value`,
      returnByValue: true,
    });
    console.log('Loaded project in UI:', checkRes.result?.value);

    // Open via ProjectLibrary modal if needed
    if (!checkRes.result?.value || (checkRes.result?.value !== "kenjo punya" && !checkRes.result?.value.includes("Physical Route"))) {
      console.log('Opening via ProjectLibrary modal...');
      await send('Runtime.evaluate', {
        expression: `
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('My Projects'));
          if (btn) btn.click();
        `,
      });

      // Wait for project library rows to appear
      await send('Runtime.evaluate', {
        awaitPromise: true,
        expression: `
          new Promise((resolve) => {
            const check = () => {
              const rows = document.querySelectorAll('.project-library-row');
              if (rows.length > 0) resolve(true);
              else setTimeout(check, 250);
            };
            check();
          });
        `,
      });

      console.log('Project library rows loaded, clicking target project...');
      await send('Runtime.evaluate', {
        expression: `
          (() => {
            const rows = Array.from(document.querySelectorAll('.project-library-row'));
            const targetRow = rows.find(r => r.textContent.includes('kenjo punya') || r.textContent.includes('Physical Route') || r.textContent.includes('test-proj-calc-physical'));
            if (targetRow) {
              const openBtn = targetRow.querySelector('button');
              if (openBtn) openBtn.click();
            }
          })()
        `,
      });

      // Wait for modal to close and project to load
      await send('Runtime.evaluate', {
        awaitPromise: true,
        expression: `
          new Promise((resolve) => {
            const check = () => {
              const val = document.querySelector('input[aria-label="Project name"]')?.value;
              const modal = document.querySelector('.project-library-backdrop');
              if (!modal && val && (val.includes('kenjo') || val.includes('Physical Route'))) {
                resolve(true);
              } else {
                setTimeout(check, 300);
              }
            };
            check();
          });
        `,
      });
      console.log('Target project loaded into UI!');
      await new Promise((r) => setTimeout(r, 1500));
    }

    const verifiedRes = await send('Runtime.evaluate', {
      expression: `document.querySelector('input[aria-label="Project name"]')?.value`,
      returnByValue: true,
    });
    console.log('Verified active project in UI:', verifiedRes.result?.value);

    // -------------------------------------------------------------
    // PART 1: OPTICAL ENGINEERING REPORT
    // -------------------------------------------------------------
    console.log('\n--- GENERATING OPTICAL ENGINEERING REPORT ---');
    console.log('Clicking Analyze...');
    await send('Runtime.evaluate', {
      expression: `
        const analyzeBtn = document.querySelector('button[aria-label="Run Optical Analysis"]') ||
          Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Analyze');
        if (analyzeBtn) analyzeBtn.click();
      `,
    });

    console.log('Waiting for optical analysis to complete...');
    await send('Runtime.evaluate', {
      awaitPromise: true,
      expression: `
        new Promise((resolve) => {
          const start = Date.now();
          setTimeout(() => {
            const check = () => {
              const analyzeBtn = document.querySelector('button[aria-label="Run Optical Analysis"]') ||
                Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Analyze');
              const summaryText = document.querySelector('.optical-result-summary');
              if ((analyzeBtn && !analyzeBtn.disabled && summaryText) || Date.now() - start > 30000) {
                resolve(true);
              } else {
                setTimeout(check, 500);
              }
            };
            check();
          }, 1500);
        });
      `,
    });
    console.log('Optical analysis completed!');

    console.log('Opening Optical PDF Report view...');
    await send('Runtime.evaluate', {
      expression: `
        const pdfBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'PDF Report');
        if (pdfBtn) {
          pdfBtn.click();
        } else {
          const optLink = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Open optical report'));
          if (optLink) optLink.click();
        }
      `,
    });

    console.log('Waiting for formal engineering report to render...');
    await send('Runtime.evaluate', {
      awaitPromise: true,
      expression: `
        new Promise((resolve) => {
          const start = Date.now();
          const check = () => {
            const report = document.querySelector('.formal-telecom-report');
            const ontRows = document.querySelectorAll('#section-3-ont-table tbody tr');
            if ((report && ontRows.length >= 100) || Date.now() - start > 25000) {
              resolve(true);
            } else {
              setTimeout(check, 400);
            }
          };
          check();
        });
      `,
    });
    console.log('Report rendered with complete ONT schedule!');
    await new Promise((r) => setTimeout(r, 2000));

    const reportInfo = await send('Runtime.evaluate', {
      expression: `({
        title: document.querySelector('.cover-project-title')?.textContent,
        sections: document.querySelectorAll('.report-formal-section').length,
        ontRows: document.querySelectorAll('#section-3-ont-table tbody tr').length,
      })`,
      returnByValue: true,
    });
    console.log('Report info:', JSON.stringify(reportInfo.result?.value, null, 2));

    await send('Emulation.setEmulatedMedia', { media: 'print' });

    console.log('Printing Engineering Report to PDF via CDP (A4 Portrait)...');
    const pdfResult = await send('Page.printToPDF', {
      landscape: false,
      displayHeaderFooter: false,
      printBackground: true,
      preferCSSPageSize: true,
      marginTop: 0.4,
      marginBottom: 0.4,
      marginLeft: 0.4,
      marginRight: 0.4,
    });

    const buffer = Buffer.from(pdfResult.data, 'base64');
    const outputPath = 'ftth_engineering_report_final.pdf';
    fs.writeFileSync(outputPath, buffer);
    console.log(`Successfully generated ${outputPath} (${buffer.length} bytes)`);

    // -------------------------------------------------------------
    // PART 2: RAB (RENCANA ANGGARAN BIAYA) REPORT
    // -------------------------------------------------------------
    console.log('\n--- GENERATING RAB (BILL OF QUANTITIES) REPORT ---');
    await send('Emulation.setEmulatedMedia', { media: '' });

    console.log('Returning to editor...');
    await send('Runtime.evaluate', {
      expression: `
        const backBtn = document.querySelector('button[aria-label="Back to Editor"]') ||
          Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Back to Editor'));
        if (backBtn) backBtn.click();
      `,
    });
    await new Promise((r) => setTimeout(r, 1500));

    console.log('Opening RAB report (triggering calculation)...');
    await send('Runtime.evaluate', {
      expression: `
        const rabLink = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Open RAB report'));
        if (rabLink) rabLink.click();
      `,
    });

    console.log('Waiting for RAB report to render...');
    await send('Runtime.evaluate', {
      awaitPromise: true,
      expression: `
        new Promise((resolve) => {
          const start = Date.now();
          const check = () => {
            const rabReport = document.querySelector('.formal-rab-report');
            const grandTotal = document.querySelector('.report-grand-total');
            if ((rabReport && grandTotal) || Date.now() - start > 25000) {
              resolve(true);
            } else {
              setTimeout(check, 400);
            }
          };
          check();
        });
      `,
    });
    console.log('RAB Report rendered!');
    await new Promise((r) => setTimeout(r, 2000));

    const rabInfo = await send('Runtime.evaluate', {
      expression: `({
        title: document.querySelector('.cover-project-title')?.textContent,
        sections: document.querySelectorAll('.report-formal-section').length,
        itemsCount: document.querySelectorAll('.report-formal-table tbody tr').length,
        grandTotalText: document.querySelector('.report-grand-total')?.textContent
      })`,
      returnByValue: true,
    });
    console.log('RAB Report info:', JSON.stringify(rabInfo.result?.value, null, 2));

    await send('Emulation.setEmulatedMedia', { media: 'print' });

    console.log('Printing RAB to PDF via CDP (A4 Portrait)...');
    const rabPdfResult = await send('Page.printToPDF', {
      landscape: false,
      displayHeaderFooter: false,
      printBackground: true,
      preferCSSPageSize: true,
      marginTop: 0.4,
      marginBottom: 0.4,
      marginLeft: 0.4,
      marginRight: 0.4,
    });

    const rabBuffer = Buffer.from(rabPdfResult.data, 'base64');
    const rabOutputPath = 'ftth_rab_report_final.pdf';
    fs.writeFileSync(rabOutputPath, rabBuffer);
    console.log(`Successfully generated ${rabOutputPath} (${rabBuffer.length} bytes)`);

    ws.close();
  } finally {
    browserProc.kill();
    await new Promise((r) => setTimeout(r, 1000));
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // ignore tmp cleanup error
    }
  }
}

main().catch((err) => {
  console.error('Error generating PDF:', err);
  process.exit(1);
});
