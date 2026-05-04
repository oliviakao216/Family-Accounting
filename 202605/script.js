// 分類選項定義 (可動態新增)
let CATEGORIES = [
    "未分類",
    "母親照顧",
    "醫療",
    "食",
    "交通",
    "家用"
];

// 嘗試從瀏覽器記憶體載入自訂分類
const savedCat = localStorage.getItem('customCategories');
if (savedCat) {
    const parsed = JSON.parse(savedCat);
    parsed.forEach(c => {
        if (!CATEGORIES.includes(c)) CATEGORIES.push(c);
    });
}

// 全域狀態
let state = {
    bankRecords: [],
    ecommerceOrders: [],
    conflicts: [], // 需要手動選擇的衝突清單
    currentConflict: null,
    currentTab: 'all' // all, 家用, 私用
};

// DOM 元素
const tableBody = document.getElementById('transaction-body');
const summaryList = document.getElementById('summary-list');
const grandTotalEl = document.getElementById('grand-total');
const runMatchBtn = document.getElementById('run-match-btn');
const modal = document.getElementById('conflict-modal');
const optionsContainer = document.getElementById('conflict-options');
const printBtn = document.getElementById('print-btn'); // 匯出 PDF 按鈕
const exportBtn = document.getElementById('export-btn'); // 新增的匯出按鈕
const addManualBtn = document.getElementById('add-manual-btn'); // 手動新增按鈕

// 初始化
async function init() {
    try {
        const response = await fetch('Data/data.json');
        const data = await response.json();
        state.bankRecords = data.bankRecords;
        state.ecommerceOrders = data.ecommerceOrders;
        
        // 載入使用者手動新增的紀錄
        const manualRecords = JSON.parse(localStorage.getItem('manualRecords_202605') || '[]');
        manualRecords.forEach(mRecord => {
            if (!state.bankRecords.find(r => r.id === mRecord.id)) {
                state.bankRecords.push(mRecord);
            }
        });

        // 載入使用者存在瀏覽器裡的手動修改紀錄
        const userEdits = JSON.parse(localStorage.getItem('userEdits_202605') || '{}');
        const orderEdits = JSON.parse(localStorage.getItem('orderEdits_202605') || '{}');
        
        // 載入被刪除的紀錄
        const deletedRecords = JSON.parse(localStorage.getItem('deletedRecords_202605') || '[]');

        // 過濾掉被刪除的資料
        state.bankRecords = state.bankRecords.filter(r => !deletedRecords.includes(r.id));

        // 初步自動分類及設定預設歸屬
        state.bankRecords.forEach(record => {
            if (!record.usageType) {
                record.usageType = "家用"; // 預設歸屬為家用
            }
        });
        autoCategorizeBase();
        
        // 覆寫為使用者的修改紀錄 (包含自訂分類、自訂摘要、歸屬、以及自動比對的結果)
        state.bankRecords.forEach(record => {
            if (userEdits[record.id]) {
                if (userEdits[record.id].category) record.category = userEdits[record.id].category;
                if (userEdits[record.id].usageType) record.usageType = userEdits[record.id].usageType;
                if (userEdits[record.id].customSummary !== undefined) record.customSummary = userEdits[record.id].customSummary;
                if (userEdits[record.id].matchedOrder) {
                    record.matchedOrder = userEdits[record.id].matchedOrder;
                    record.matchedItems = userEdits[record.id].matchedItems;
                }
            }
        });

        // 標記已經配對過的電商訂單
        state.ecommerceOrders.forEach(o => {
            if (orderEdits[o.id]) o.isMatched = true;
        });
        
        // 綁定頁籤事件
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                state.currentTab = e.target.getAttribute('data-tab');
                renderTable();
                updateSummary();
            });
        });

        // 渲染畫面
        renderTable();
        updateSummary();
    } catch (error) {
        console.error("無法載入資料", error);
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:red;">資料載入失敗，請確認 Data/data.json 是否存在。</td></tr>`;
    }
}

// 基礎自動分類 (依據銀行明細字眼)
function autoCategorizeBase() {
    state.bankRecords.forEach(record => {
        if (record.category) return; // 已有分類則跳過
        const detail = record.details;
        
        if (/醫院|杏一|藥局|診所/i.test(detail)) {
            record.category = "醫療";
        } else if (/超商|foodpanda|優步|uber|排骨|便當|餐|扁食|微風|福穀|海鮮|雞肉|麵|定食|COFFEE|早午餐|飲料|午餐|晚餐/i.test(detail)) {
            record.category = "食";
        } else if (/中油|停車|捷運|台鐵|高鐵/i.test(detail)) {
            record.category = "交通";
        } else if (/家樂福|美廉社|PCHOME|寶雅/i.test(detail)) {
            record.category = "家用";
        } else if (/鼻胃管|尿布|補體康/i.test(detail)) {
            record.category = "母親照顧";
        } else {
            record.category = "未分類";
        }
    });
}

// 根據電商購買商品自動更新分類
function updateCategoryFromItems(record, items) {
    const itemNames = items.map(i => i.name).join(" ");
    if (/尿布|補體康|濕紙巾|足貼|生理食鹽水|棉棒|紗布巾/.test(itemNames)) {
        record.category = "母親照顧";
    } else if (/記憶卡|衛生紙|牙膏/.test(itemNames)) {
        record.category = "家用";
    } else if (/蛋白粉|水肌|包子|饅頭/.test(itemNames)) {
        record.category = "食";
    } else if (/健康日記/.test(itemNames)) {
        record.category = "醫療";
    }
}

// 渲染表格
function renderTable() {
    tableBody.innerHTML = '';
    
    // 根據頁籤過濾資料
    const filteredRecords = state.bankRecords.filter(record => 
        state.currentTab === 'all' || record.usageType === state.currentTab
    );
    
    filteredRecords.forEach(record => {
        const tr = document.createElement('tr');
        
        // 銀行標籤
        const bankTd = `<td><span class="bank-tag">${record.bank}</span></td>`;
        
        // 日期與明細
        const dateTd = `<td>${record.date}</td>`;
        const detailTd = `<td class="detail-text">${record.details}</td>`;
        
        // 分類選單
        let catOptions = CATEGORIES.map(c => 
            `<option value="${c}" ${record.category === c ? 'selected' : ''}>${c}</option>`
        ).join('');
        catOptions += `<option value="ADD_NEW" style="font-weight: bold; color: var(--primary-color);">➕ 新增分類...</option>`;
        const catTd = `<td><select class="cat-select" data-id="${record.id}">${catOptions}</select></td>`;
        
        // 購買項目摘要 (可輸入)
        let countHtml = '';
        let summaryText = record.customSummary || '';
        
        if (!record.customSummary && record.matchedItems && record.matchedItems.length > 0) {
            const count = record.matchedItems.length;
            summaryText = record.matchedItems.slice(0, 2).map(i => i.name).join('、');
            if (count > 2) summaryText += '...等';
            countHtml = `<span class="item-count">共 ${count} 項</span>`;
        }

        const itemTd = `
            <td>
                <div class="item-summary">
                    ${countHtml}
                    <input type="text" class="summary-input ${!summaryText ? 'empty' : ''}" 
                           data-id="${record.id}" 
                           value="${summaryText}" 
                           placeholder="點擊輸入自訂摘要...">
                </div>
            </td>
        `;

        // 歸屬選單 (私用/家用/家庭開支)
        let usageOptions = ["家用", "私用", "家庭開支"].map(u => 
            `<option value="${u}" ${record.usageType === u ? 'selected' : ''}>${u}</option>`
        ).join('');
        const usageTd = `<td><select class="usage-select" data-id="${record.id}">${usageOptions}</select></td>`;

        // 金額
        const twdTd = `<td class="text-right amount ${record.amountTWD < 0 ? 'negative' : ''}">${record.amountTWD}</td>`;
        const forTd = `<td class="text-right">${record.amountForeign ? record.amountForeign + ' ' + record.currency : '-'}</td>`;

        // 刪除按鈕
        const actionTd = `<td style="text-align: center;"><button class="delete-btn" data-id="${record.id}" title="刪除此紀錄">🗑️</button></td>`;

        tr.innerHTML = bankTd + dateTd + detailTd + catTd + itemTd + usageTd + twdTd + forTd + actionTd;
        tableBody.appendChild(tr);
    });

    // 綁定下拉選單事件
    document.querySelectorAll('.cat-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const id = e.target.getAttribute('data-id');
            const record = state.bankRecords.find(r => r.id === id);
            
            // 處理新增分類
            if (e.target.value === 'ADD_NEW') {
                const newCat = prompt('請輸入新的自訂分類名稱：');
                if (newCat && newCat.trim() !== '') {
                    const cleanCat = newCat.trim();
                    if (!CATEGORIES.includes(cleanCat)) {
                        CATEGORIES.push(cleanCat);
                        localStorage.setItem('customCategories', JSON.stringify(CATEGORIES));
                    }
                    if (record) record.category = cleanCat;
                } else {
                    // 取消或空白則恢復原狀
                    e.target.value = record ? record.category : '未分類';
                    return;
                }
                renderTable(); // 重新渲染以更新所有選單
                updateSummary();
                saveLocalEdits();
                return;
            }

            if (record) {
                record.category = e.target.value;
                updateSummary();
                saveLocalEdits();
            }
        });
    });

    // 綁定歸屬選單事件
    document.querySelectorAll('.usage-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const id = e.target.getAttribute('data-id');
            const record = state.bankRecords.find(r => r.id === id);
            if (record) {
                record.usageType = e.target.value;
                // 若改變後不符合當前頁籤，重新渲染
                if (state.currentTab !== 'all' && record.usageType !== state.currentTab) {
                    renderTable();
                }
                updateSummary();
                saveLocalEdits();
            }
        });
    });

    // 綁定摘要修改事件
    document.querySelectorAll('.summary-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const id = e.target.getAttribute('data-id');
            const record = state.bankRecords.find(r => r.id === id);
            if (record) {
                record.customSummary = e.target.value;
                e.target.classList.toggle('empty', !e.target.value);
                saveLocalEdits();
            }
        });
    });

    // 綁定刪除事件
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            const record = state.bankRecords.find(r => r.id === id);
            if (!record) return;
            
            if (confirm(`確定要刪除「${record.details}」這筆紀錄嗎？\n(刪除後若按下匯出儲存，此項目將會永久移除)`)) {
                // 從狀態中移除
                state.bankRecords = state.bankRecords.filter(r => r.id !== id);
                
                // 從手動新增清單移除 (如果是手動新增的話)
                let manualRecords = JSON.parse(localStorage.getItem('manualRecords_202605') || '[]');
                manualRecords = manualRecords.filter(r => r.id !== id);
                localStorage.setItem('manualRecords_202605', JSON.stringify(manualRecords));
                
                // 標記為已刪除 (防止重整後從 data.json 又載入)
                let deletedRecords = JSON.parse(localStorage.getItem('deletedRecords_202605') || '[]');
                if (!deletedRecords.includes(id)) {
                    deletedRecords.push(id);
                    localStorage.setItem('deletedRecords_202605', JSON.stringify(deletedRecords));
                }
                
                // 重新渲染並儲存狀態
                renderTable();
                updateSummary();
                saveLocalEdits();
            }
        });
    });
}

// 更新小計與總額
function updateSummary() {
    const summary = {};
    let grandTotal = 0;

    const familySummary = {};
    let familyGrandTotal = 0;

    CATEGORIES.forEach(c => {
        summary[c] = 0;
        familySummary[c] = 0;
    });

    // 家用計算
    const householdRecords = state.bankRecords.filter(record => 
        record.usageType === '家用'
    );
    householdRecords.forEach(r => {
        const amt = parseFloat(r.amountTWD);
        if (!isNaN(amt) && amt > 0) { // 假設正數為支出
            summary[r.category] += amt;
            grandTotal += amt;
        }
    });

    // 家庭開支計算
    const familyRecords = state.bankRecords.filter(record => 
        record.usageType === '家庭開支'
    );
    familyRecords.forEach(r => {
        const amt = parseFloat(r.amountTWD);
        if (!isNaN(amt) && amt > 0) {
            familySummary[r.category] += amt;
            familyGrandTotal += amt;
        }
    });

    summaryList.innerHTML = '';
    const familySummaryList = document.getElementById('family-summary-list');
    if (familySummaryList) {
        familySummaryList.innerHTML = '';
    }
    
    // 定義顏色
    const colors = {
        "食": "var(--cat-food)",
        "交通": "var(--cat-transport)",
        "醫療": "var(--cat-medical)",
        "家用": "var(--cat-household)",
        "母親照顧": "var(--cat-mother)",
        "未分類": "var(--cat-other)"
    };

    CATEGORIES.forEach(cat => {
        // 渲染家用小計
        if (cat !== "未分類" && summary[cat] > 0) {
            const div = document.createElement('div');
            div.className = 'summary-item';
            div.innerHTML = `
                <div class="summary-label">
                    <span class="cat-dot" style="background-color: ${colors[cat] || 'gray'}"></span>
                    ${cat}
                </div>
                <div class="summary-value">NT$ ${summary[cat]}</div>
            `;
            summaryList.appendChild(div);
        }

        // 渲染家庭開支小計
        if (cat !== "未分類" && familySummary[cat] > 0 && familySummaryList) {
            const div = document.createElement('div');
            div.className = 'summary-item';
            div.innerHTML = `
                <div class="summary-label">
                    <span class="cat-dot" style="background-color: ${colors[cat] || 'gray'}"></span>
                    ${cat}
                </div>
                <div class="summary-value">NT$ ${familySummary[cat]}</div>
            `;
            familySummaryList.appendChild(div);
        }
    });

    grandTotalEl.textContent = `NT$ ${grandTotal}`;
    const familyGrandTotalEl = document.getElementById('family-grand-total');
    if (familyGrandTotalEl) {
        familyGrandTotalEl.textContent = `NT$ ${familyGrandTotal}`;
    }

    // 更新合併總計
    const combinedGrandTotalEl = document.getElementById('combined-grand-total');
    if (combinedGrandTotalEl) {
        combinedGrandTotalEl.textContent = `NT$ ${grandTotal + familyGrandTotal}`;
    }
}

// 執行自動比對
runMatchBtn.addEventListener('click', () => {
    state.conflicts = [];
    
    // 找出需要比對的銀行紀錄 (關鍵字含蝦皮、酷澎、momo) 且尚未匹配的
    const targetRecords = state.bankRecords.filter(r => 
        /蝦皮|酷澎|momo/i.test(r.details) && !r.matchedOrder
    );

    targetRecords.forEach(record => {
        // 尋找相同金額的訂單
        const matchedOrders = state.ecommerceOrders.filter(o => o.total === record.amountTWD && !o.isMatched);
        
        if (matchedOrders.length === 1) {
            // 單一符合，自動配對
            matchRecordToOrder(record, matchedOrders[0]);
        } else if (matchedOrders.length > 1) {
            // 多個符合，加入衝突清單
            state.conflicts.push({
                record: record,
                options: matchedOrders
            });
        }
    });

    // 處理衝突
    if (state.conflicts.length > 0) {
        processNextConflict();
    } else {
        alert('比對完成！沒有遇到衝突。');
        renderTable();
        updateSummary();
        setButtonDone();
    }
});

// 設定按鈕為已完成的灰色狀態
function setButtonDone() {
    runMatchBtn.disabled = true;
    runMatchBtn.style.backgroundColor = '#a0aec0';
    runMatchBtn.style.cursor = 'not-allowed';
    runMatchBtn.style.boxShadow = 'none';
    runMatchBtn.style.transform = 'none';
    runMatchBtn.innerHTML = '<span class="icon">✔️</span> 蝦皮/酷澎/momo 已比對完成';
}

// 匯出 PDF (強制只匯出家用資料)
printBtn.addEventListener('click', () => {
    // 取得資料的年月 (從副標題文字抓取，例如「2026年 4月 帳務總覽」)
    let yyyymm = "";
    const subtitleEl = document.querySelector('.subtitle');
    if (subtitleEl) {
        const text = subtitleEl.textContent;
        const yearMatch = text.match(/(\d{4})\s*年/);
        const monthMatch = text.match(/(\d{1,2})\s*月/);
        
        if (yearMatch && monthMatch) {
            const yyyy = yearMatch[1];
            const mm = monthMatch[1].padStart(2, '0');
            yyyymm = `${yyyy}${mm}`; // 組合為 202605
        }
    }
    
    // 如果從副標題抓不到，試著從網址路徑抓取 (例如 /202605/)
    if (!yyyymm) {
        const urlMatch = window.location.pathname.match(/\/(\d{6})\//);
        if (urlMatch) {
            yyyymm = urlMatch[1];
        }
    }

    // 記住原本所在的頁籤與標題
    const prevTab = state.currentTab;
    const originalTitle = document.title;
    
    // 強制更改標題 (瀏覽器會用這個當作 PDF 的預設檔名)
    if (yyyymm) {
        document.title = `家庭帳務整理${yyyymm}`;
    }

    // 強制切換到「家用」
    state.currentTab = '家用';
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-tab') === '家用');
    });
    renderTable();
    updateSummary();
    
    // 延遲一點確保畫面渲染完成再打開列印視窗
    setTimeout(() => {
        window.print();
        
        // 列印結束後自動恢復原本的頁籤與標題
        document.title = originalTitle;
        state.currentTab = prevTab;
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-tab') === prevTab);
        });
        renderTable();
        updateSummary();
    }, 150);
});

// 匯出資料功能
exportBtn.addEventListener('click', async () => {
    // 建立一個包含最新狀態的物件
    const exportData = {
        bankRecords: state.bankRecords,
        ecommerceOrders: state.ecommerceOrders
    };
    const jsonString = JSON.stringify(exportData, null, 2);
    
    try {
        // 嘗試使用現代瀏覽器的「檔案系統寫入 API」
        if ('showSaveFilePicker' in window) {
            const fileHandle = await window.showSaveFilePicker({
                id: 'family-accounting-data', // 讓瀏覽器記住上次儲存的路徑
                suggestedName: 'data.json',
                types: [{
                    description: 'JSON 檔案',
                    accept: {'application/json': ['.json']}
                }]
            });
            
            // 建立寫入流並寫入資料
            const writable = await fileHandle.createWritable();
            await writable.write(jsonString);
            await writable.close();
            
            alert('✅ 儲存成功！您的修改已經完美且永久地覆蓋原本的檔案了！\n現在就算清除 Cookie 也不怕囉！');
        } else {
            // 若瀏覽器不支援，則退回原本的下載模式
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonString);
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", "data.json");
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            alert('✅ 已下載 data.json！請將它移動到 Data 資料夾中取代舊檔。');
        }
    } catch (err) {
        // 使用者取消視窗時會跑到這裡，我們忽略取消錯誤
        if (err.name !== 'AbortError') {
            console.error('存檔失敗', err);
            alert('存檔時發生錯誤。');
        }
    }
});

// 快速輸入標籤清單
let QUICK_TAGS = [
    "水費", "電費", "電話費", "櫟安司機揹錢", "房屋稅", "地價稅", 
    "國有財產局地租", "外看薪水", "外看餐費", "勞保費", "健保費", 
    "餐食", "藥品", "櫟安交通費"
];

// 載入自訂的快速標籤
const savedTags = localStorage.getItem('customQuickTags');
if (savedTags) {
    const parsed = JSON.parse(savedTags);
    parsed.forEach(t => {
        if (!QUICK_TAGS.includes(t)) QUICK_TAGS.push(t);
    });
}

function renderQuickTags() {
    const container = document.getElementById('quick-tags');
    container.innerHTML = '';
    QUICK_TAGS.forEach(tag => {
        const btn = document.createElement('button');
        btn.className = 'quick-tag';
        btn.textContent = tag;
        btn.onclick = () => {
            document.getElementById('manual-details').value = tag;
        };
        container.appendChild(btn);
    });
    
    // 新增標籤按鈕
    const addBtn = document.createElement('button');
    addBtn.className = 'quick-tag';
    addBtn.style.background = '#edf2f7';
    addBtn.style.color = 'var(--primary-color)';
    addBtn.style.fontWeight = 'bold';
    addBtn.textContent = '➕ 新增常用項目';
    addBtn.onclick = () => {
        const newTag = prompt('請輸入新的快速標籤名稱：');
        if (newTag && newTag.trim() !== '') {
            QUICK_TAGS.push(newTag.trim());
            localStorage.setItem('customQuickTags', JSON.stringify(QUICK_TAGS));
            renderQuickTags();
        }
    };
    container.appendChild(addBtn);
}

// 手動新增一筆帳務 (改用 Modal)
const manualModal = document.getElementById('manual-modal');

addManualBtn.addEventListener('click', () => {
    // 渲染分類下拉選單
    const catSelect = document.getElementById('manual-cat');
    catSelect.innerHTML = '';
    CATEGORIES.forEach(c => {
        catSelect.innerHTML += `<option value="${c}">${c}</option>`;
    });
    
    // 初始化數值
    document.getElementById('manual-date').value = "2026-05-";
    document.getElementById('manual-details').value = "";
    document.getElementById('manual-amount').value = "";
    document.getElementById('manual-usage').value = "家用";
    
    // 渲染標籤
    renderQuickTags();
    
    // 顯示視窗
    manualModal.classList.add('active');
});

// 取消新增
document.getElementById('cancel-manual-btn').addEventListener('click', () => {
    manualModal.classList.remove('active');
});

// 確認新增
document.getElementById('confirm-manual-btn').addEventListener('click', () => {
    const date = document.getElementById('manual-date').value.trim();
    const details = document.getElementById('manual-details').value.trim();
    const amountStr = document.getElementById('manual-amount').value.trim();
    const cat = document.getElementById('manual-cat').value;
    const usage = document.getElementById('manual-usage').value;
    
    let amountTWD = NaN;
    if (amountStr) {
        try {
            // 允許輸入數學算式，過濾掉非數學字元確保安全
            const safeStr = amountStr.replace(/[^0-9+\-*/.() ]/g, '');
            // 計算結果
            amountTWD = parseFloat(Function('"use strict";return (' + safeStr + ')')());
        } catch (e) {
            amountTWD = NaN;
        }
    }
    
    if (!date || !details || isNaN(amountTWD)) {
        alert("請確認所有欄位都已正確填寫，且金額請輸入有效的數字或算式（例如：848+550）！");
        return;
    }

    const newRecord = {
        id: "m_" + Date.now(),
        bank: "手帳",
        date: date,
        details: details,
        amountTWD: amountTWD,
        amountForeign: "",
        currency: "TWD",
        category: cat,
        usageType: usage
    };

    state.bankRecords.push(newRecord);
    
    // 獨立儲存這筆完全手動新增的資料，避免重整後消失
    let manualRecords = JSON.parse(localStorage.getItem('manualRecords_202605') || '[]');
    manualRecords.push(newRecord);
    localStorage.setItem('manualRecords_202605', JSON.stringify(manualRecords));

    // 如果使用者選擇了「未分類」，就再嘗試幫他自動判斷一次
    if (cat === "未分類" || cat === CATEGORIES[0]) {
        autoCategorizeBase();
    }

    // 重新渲染並儲存狀態
    renderTable();
    updateSummary();
    saveLocalEdits();
    
    manualModal.classList.remove('active');
});

// 配對銀行與訂單
function matchRecordToOrder(record, order) {
    record.matchedOrder = order.id;
    record.matchedItems = order.items;
    order.isMatched = true; // 標記為已配對，避免重複
    // 根據購買項目更新分類
    updateCategoryFromItems(record, order.items);
    saveLocalEdits();
}

// 將使用者的修改儲存到瀏覽器的 localStorage
function saveLocalEdits() {
    const edits = {};
    state.bankRecords.forEach(r => {
        edits[r.id] = {
            category: r.category,
            usageType: r.usageType,
            customSummary: r.customSummary,
            matchedOrder: r.matchedOrder,
            matchedItems: r.matchedItems
        };
    });
    
    const orderEdits = {};
    state.ecommerceOrders.forEach(o => {
        if (o.isMatched) orderEdits[o.id] = true;
    });

    localStorage.setItem('userEdits_202605', JSON.stringify(edits));
    localStorage.setItem('orderEdits_202605', JSON.stringify(orderEdits));
}

// 處理衝突佇列
function processNextConflict() {
    if (state.conflicts.length === 0) {
        alert('所有衝突已處理完成！');
        renderTable();
        updateSummary();
        modal.classList.remove('active');
        setButtonDone();
        return;
    }

    state.currentConflict = state.conflicts.shift();
    const record = state.currentConflict.record;
    const options = state.currentConflict.options;

    document.getElementById('conflict-bank-detail').textContent = record.details;
    document.getElementById('conflict-amount').textContent = `NT$ ${record.amountTWD}`;

    optionsContainer.innerHTML = '';
    options.forEach(opt => {
        const itemsText = opt.items.map(i => `${i.name}($${i.price})`).join(', ');
        const card = document.createElement('div');
        card.className = 'option-card';
        card.innerHTML = `
            <div class="option-info">
                <h4>${opt.platform} - 總額 $${opt.total}</h4>
                <p>項目: ${itemsText}</p>
            </div>
            <button class="primary-btn" style="padding: 0.5rem 1rem; font-size:0.9rem;">選取此項</button>
        `;
        
        card.querySelector('button').addEventListener('click', () => {
            matchRecordToOrder(record, opt);
            processNextConflict();
        });
        
        optionsContainer.appendChild(card);
    });

    modal.classList.add('active');
}

// 略過衝突按鈕
document.getElementById('skip-conflict-btn').addEventListener('click', () => {
    processNextConflict();
});

// 啟動應用程式
window.addEventListener('DOMContentLoaded', init);
