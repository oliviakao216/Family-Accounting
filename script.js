// Supabase 初始化
const supabaseUrl = 'https://vawvpyzphddhqfpxuupa.supabase.co';
const supabaseKey = 'sb_publishable_JuBZihBwRx9VOnsqcHOBBw_tI1-ld8T';
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

// 分類選項定義
let CATEGORIES = [
    "未分類", "母親照顧", "醫療", "食", "交通", "家用"
];

// 載入自訂分類
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
    currentMonth: document.getElementById('month-selector').value,
    currentTab: 'all',
    editingId: null
};

// DOM 元素
const tableBody = document.getElementById('transaction-body');
const summaryList = document.getElementById('summary-list');
const grandTotalEl = document.getElementById('grand-total');
const addManualBtn = document.getElementById('add-manual-btn');
const importBtn = document.getElementById('import-btn');
const fileUpload = document.getElementById('file-upload');
const monthSelector = document.getElementById('month-selector');
const runMatchBtn = document.getElementById('run-match-btn');
const modal = document.getElementById('conflict-modal');
const optionsContainer = document.getElementById('conflict-options');

// 切換月份
monthSelector.addEventListener('change', (e) => {
    state.currentMonth = e.target.value;
    const savedOrders = localStorage.getItem('ecommerceOrders_' + state.currentMonth);
    state.ecommerceOrders = savedOrders ? JSON.parse(savedOrders) : [];
    // 重設比對按鈕狀態
    resetMatchButton();
    loadData();
});

// 重設比對按鈕
function resetMatchButton() {
    runMatchBtn.disabled = false;
    runMatchBtn.style.backgroundColor = '';
    runMatchBtn.style.cursor = '';
    runMatchBtn.style.boxShadow = '';
    runMatchBtn.style.transform = '';
    runMatchBtn.innerHTML = '<span class="icon">🔍</span> 執行自動比對';
}

// 初始化
async function init() {
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

    // 取得當天日期自動填入手動新增表單
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    document.getElementById('manual-date').value = `${yyyy}-${mm}-${dd}`;

    // 嘗試載入當前月份已快取的電商訂單
    const savedOrders = localStorage.getItem('ecommerceOrders_' + state.currentMonth);
    if (savedOrders) {
        state.ecommerceOrders = JSON.parse(savedOrders);
    }

    await loadData();
}

// 載入資料 (從 Supabase)
async function loadData() {
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 2rem;">⏳ 正在從雲端載入資料...</td></tr>`;
    
    try {
        const { data, error } = await supabaseClient
            .from('transactions')
            .select('*')
            .eq('month', state.currentMonth)
            .order('date', { ascending: false });

        if (error) throw error;

        // 將資料庫的蛇形命名 (snake_case) 轉回原本的駝峰命名 (camelCase)
        state.bankRecords = data.map(r => {
            const matchedOrd = state.ecommerceOrders.find(o => o.id === r.matched_order);
            return {
                id: r.id,
                month: r.month,
                bank: r.bank,
                date: r.date,
                details: r.details,
                amountTWD: r.amount_twd,
                amountForeign: r.amount_foreign,
                currency: r.currency,
                category: r.category,
                usageType: r.usage_type,
                customSummary: r.custom_summary,
                matchedOrder: r.matched_order,
                matchedItems: matchedOrd ? matchedOrd.items : []
            };
        });
        
        // 標記已經配對過的電商訂單為已配對，避免重複被配對
        state.ecommerceOrders.forEach(o => {
            const isMatched = state.bankRecords.some(r => r.matchedOrder === o.id);
            o.isMatched = isMatched;
        });
        
        // 自動分類 (如果還沒分類)
        autoCategorizeBase();

        renderTable();
        updateSummary();
    } catch (error) {
        console.error("載入失敗:", error);
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:red; padding: 2rem;">❌ 載入失敗或資料庫未建立！請確認是否已經在 Supabase 建立 transactions 資料表。</td></tr>`;
    }
}

// 匯入舊的 JSON 資料到 Supabase
importBtn.addEventListener('click', () => {
    fileUpload.click();
});

fileUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const data = JSON.parse(event.target.result);
            if (!data.bankRecords) {
                alert("錯誤：這不是正確的格式");
                return;
            }
            
            alert(`讀取到 ${data.bankRecords.length} 筆銀行紀錄！\n即將上傳至 ${state.currentMonth} 月份雲端資料庫...\n(請耐心等候幾秒鐘)`);
            
            // 處理電商訂單快取
            if (data.ecommerceOrders) {
                state.ecommerceOrders = data.ecommerceOrders;
                localStorage.setItem('ecommerceOrders_' + state.currentMonth, JSON.stringify(data.ecommerceOrders));
                resetMatchButton();
            }

            // 轉換為資料庫格式
            const insertData = data.bankRecords.map(r => ({
                id: r.id || "m_" + Date.now() + Math.random(),
                month: state.currentMonth,
                bank: r.bank,
                date: r.date,
                details: r.details,
                amount_twd: r.amountTWD,
                amount_foreign: r.amountForeign || null,
                currency: r.currency || 'TWD',
                category: r.category || '未分類',
                usage_type: r.usageType || '家用',
                custom_summary: r.customSummary || null,
                matched_order: r.matchedOrder || null
            }));

            // 批次寫入 Supabase (使用 upsert 避免重複 ID 報錯)
            const { error } = await supabaseClient
                .from('transactions')
                .upsert(insertData, { onConflict: 'id' });

            if (error) throw error;
            
            alert('✅ 匯入成功！資料已經永久保存在雲端！');
            loadData(); // 重新載入
        } catch (error) {
            console.error("匯入失敗", error);
            alert("匯入失敗：" + error.message);
        }
    };
    reader.readAsText(file);
    e.target.value = ''; // 清空選擇
});

// 基礎自動分類
function autoCategorizeBase() {
    let hasChanged = false;
    state.bankRecords.forEach(record => {
        if (!record.usageType) record.usageType = "家用";
        
        if (record.category && record.category !== "未分類") return; 
        const detail = record.details;
        
        if (/醫院|杏一|藥局|診所/i.test(detail)) {
            record.category = "醫療"; hasChanged = true;
        } else if (/超商|foodpanda|優步|uber|排骨|便當|餐|扁食|微風|福穀|海鮮|雞肉|麵|定食|COFFEE|早午餐|飲料|午餐|晚餐/i.test(detail)) {
            record.category = "食"; hasChanged = true;
        } else if (/中油|停車|捷運|台鐵|高鐵/i.test(detail)) {
            record.category = "交通"; hasChanged = true;
        } else if (/家樂福|美廉社|PCHOME|寶雅/i.test(detail)) {
            record.category = "家用"; hasChanged = true;
        } else if (/鼻胃管|尿布|補體康/i.test(detail)) {
            record.category = "母親照顧"; hasChanged = true;
        } else {
            record.category = "未分類";
        }
    });
}

// 修改資料並同步到雲端
async function updateRecordInDb(id, updates) {
    const record = state.bankRecords.find(r => r.id === id);
    if (!record) return;

    // 先在畫面更新，保持順暢感
    Object.assign(record, updates);
    updateSummary();

    // 背景上傳到 Supabase
    const dbUpdates = {};
    if (updates.category !== undefined) dbUpdates.category = updates.category;
    if (updates.usageType !== undefined) dbUpdates.usage_type = updates.usageType;
    if (updates.customSummary !== undefined) dbUpdates.custom_summary = updates.customSummary;
    if (updates.date !== undefined) dbUpdates.date = updates.date;
    if (updates.details !== undefined) dbUpdates.details = updates.details;
    if (updates.amountTWD !== undefined) dbUpdates.amount_twd = updates.amountTWD;
    if (updates.matchedOrder !== undefined) dbUpdates.matched_order = updates.matchedOrder;
    
    await supabaseClient.from('transactions').update(dbUpdates).eq('id', id);
}

// 刪除紀錄
async function deleteRecordInDb(id) {
    // 從畫面移除
    state.bankRecords = state.bankRecords.filter(r => r.id !== id);
    renderTable();
    updateSummary();

    // 雲端移除
    await supabaseClient.from('transactions').delete().eq('id', id);
}

// 渲染表格
function renderTable() {
    tableBody.innerHTML = '';
    
    const filteredRecords = state.bankRecords.filter(record => 
        state.currentTab === 'all' || record.usageType === state.currentTab
    );
    
    filteredRecords.forEach(record => {
        const tr = document.createElement('tr');
        
        const bankTd = `<td><span class="bank-tag">${record.bank}</span></td>`;
        const dateTd = `<td>${record.date}</td>`;
        const detailTd = `<td class="detail-text">${record.details}</td>`;
        
        let catOptions = CATEGORIES.map(c => 
            `<option value="${c}" ${record.category === c ? 'selected' : ''}>${c}</option>`
        ).join('');
        catOptions += `<option value="ADD_NEW" style="font-weight: bold; color: var(--primary-color);">➕ 新增分類...</option>`;
        const catTd = `<td><select class="cat-select" data-id="${record.id}">${catOptions}</select></td>`;
        
        let countHtml = '';
        let summaryText = record.customSummary || '';
        if (!record.customSummary && record.matchedItems && record.matchedItems.length > 0) {
            const count = record.matchedItems.length;
            summaryText = record.matchedItems.slice(0, 2).map(i => i.name).join('、');
            if (count > 2) summaryText += '...等';
            countHtml = `<span class="item-count" style="font-size:0.75rem; background:#ebf8ff; color:#2b6cb0; padding:2px 6px; border-radius:4px; margin-right:4px; white-space:nowrap;">共 ${count} 項</span>`;
        }
        const itemTd = `
            <td>
                <div class="item-summary" style="display:flex; align-items:center;">
                    ${countHtml}
                    <input type="text" class="summary-input ${!summaryText ? 'empty' : ''}" 
                           data-id="${record.id}" value="${summaryText}" placeholder="點擊輸入摘要...">
                </div>
            </td>
        `;

        let usageOptions = ["家用", "私用", "家庭開支"].map(u => 
            `<option value="${u}" ${record.usageType === u ? 'selected' : ''}>${u}</option>`
        ).join('');
        const usageTd = `<td><select class="usage-select" data-id="${record.id}">${usageOptions}</select></td>`;

        const twdTd = `<td class="text-right amount ${record.amountTWD < 0 ? 'negative' : ''}">${record.amountTWD}</td>`;
        const forTd = `<td class="text-right">${record.amountForeign ? record.amountForeign + ' ' + record.currency : '-'}</td>`;

        const isManual = record.bank === "手帳" || record.id.startsWith("m_");
        const actionTd = `
            <td style="text-align: center; white-space: nowrap;">
                ${isManual ? `<button class="edit-btn secondary-btn" data-id="${record.id}" title="修改此紀錄" style="padding:0.2rem; font-size:0.8rem; margin-right:4px;">✏️</button>` : ''}
                <button class="delete-btn" data-id="${record.id}" title="刪除此紀錄">🗑️</button>
            </td>
        `;

        tr.innerHTML = bankTd + dateTd + detailTd + catTd + itemTd + usageTd + twdTd + forTd + actionTd;
        tableBody.appendChild(tr);
    });

    // 綁定事件
    document.querySelectorAll('.cat-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const id = e.target.getAttribute('data-id');
            const val = e.target.value;
            if (val === 'ADD_NEW') {
                const newCat = prompt('請輸入新分類名稱：');
                if (newCat && newCat.trim()) {
                    CATEGORIES.push(newCat.trim());
                    localStorage.setItem('customCategories', JSON.stringify(CATEGORIES));
                    updateRecordInDb(id, { category: newCat.trim() });
                    renderTable();
                } else {
                    const record = state.bankRecords.find(r => r.id === id);
                    e.target.value = record.category;
                }
            } else {
                updateRecordInDb(id, { category: val });
            }
        });
    });

    document.querySelectorAll('.usage-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const id = e.target.getAttribute('data-id');
            updateRecordInDb(id, { usageType: e.target.value });
            if (state.currentTab !== 'all') renderTable();
        });
    });

    document.querySelectorAll('.summary-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const id = e.target.getAttribute('data-id');
            updateRecordInDb(id, { customSummary: e.target.value });
            e.target.classList.toggle('empty', !e.target.value);
        });
    });

    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            const record = state.bankRecords.find(r => r.id === id);
            if (!record) return;
            
            state.editingId = id;
            document.querySelector('#manual-modal h3').textContent = '✏️ 編輯隨手記帳';
            
            const catSelect = document.getElementById('manual-cat');
            catSelect.innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
            
            document.getElementById('manual-date').value = record.date;
            document.getElementById('manual-details').value = record.details;
            document.getElementById('manual-amount').value = record.amountTWD;
            document.getElementById('manual-cat').value = record.category;
            document.getElementById('manual-usage').value = record.usageType;
            
            renderQuickTags();
            document.getElementById('manual-modal').classList.add('active');
        });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            const record = state.bankRecords.find(r => r.id === id);
            if (confirm(`確定要永久刪除「${record.details}」嗎？\n(將會從雲端同步刪除)`)) {
                deleteRecordInDb(id);
            }
        });
    });
}

// 更新小計
function updateSummary() {
    const summary = {};
    let grandTotal = 0;
    const familySummary = {};
    let familyGrandTotal = 0;

    CATEGORIES.forEach(c => { summary[c] = 0; familySummary[c] = 0; });

    state.bankRecords.forEach(r => {
        const amt = parseFloat(r.amountTWD);
        if (!isNaN(amt) && amt !== 0) {
            if (r.usageType === '家用') {
                summary[r.category] += amt;
                grandTotal += amt;
            } else if (r.usageType === '家庭開支') {
                familySummary[r.category] += amt;
                familyGrandTotal += amt;
            }
        }
    });

    summaryList.innerHTML = '';
    const familySummaryList = document.getElementById('family-summary-list');
    if (familySummaryList) familySummaryList.innerHTML = '';
    
    const colors = {
        "食": "var(--cat-food)", "交通": "var(--cat-transport)", 
        "醫療": "var(--cat-medical)", "家用": "var(--cat-household)",
        "母親照顧": "var(--cat-mother)", "未分類": "var(--cat-other)"
    };

    CATEGORIES.forEach(cat => {
        if (cat !== "未分類" && summary[cat] !== 0) {
            summaryList.innerHTML += `<div class="summary-item"><div class="summary-label"><span class="cat-dot" style="background-color: ${colors[cat] || 'gray'}"></span>${cat}</div><div class="summary-value">NT$ ${summary[cat]}</div></div>`;
        }
        if (cat !== "未分類" && familySummary[cat] !== 0 && familySummaryList) {
            familySummaryList.innerHTML += `<div class="summary-item"><div class="summary-label"><span class="cat-dot" style="background-color: ${colors[cat] || 'gray'}"></span>${cat}</div><div class="summary-value">NT$ ${familySummary[cat]}</div></div>`;
        }
    });

    grandTotalEl.textContent = `NT$ ${grandTotal}`;
    const fGT = document.getElementById('family-grand-total');
    if (fGT) fGT.textContent = `NT$ ${familyGrandTotal}`;
    const cGT = document.getElementById('combined-grand-total');
    if (cGT) cGT.textContent = `NT$ ${grandTotal + familyGrandTotal}`;
}

// 快速標籤
let QUICK_TAGS = ["水費", "電費", "電話費", "櫟安司機揹錢", "房屋稅", "地價稅", "國有財產局地租", "外看薪水", "外看餐費", "勞保費", "健保費", "餐食", "藥品", "櫟安交通費"];
const savedTags = localStorage.getItem('customQuickTags');
if (savedTags) {
    JSON.parse(savedTags).forEach(t => { if (!QUICK_TAGS.includes(t)) QUICK_TAGS.push(t); });
}

function renderQuickTags() {
    const container = document.getElementById('quick-tags');
    container.innerHTML = '';
    QUICK_TAGS.forEach(tag => {
        const btn = document.createElement('button');
        btn.className = 'quick-tag';
        btn.textContent = tag;
        btn.onclick = () => { document.getElementById('manual-details').value = tag; };
        container.appendChild(btn);
    });
    
    const addBtn = document.createElement('button');
    addBtn.className = 'quick-tag';
    addBtn.style.background = '#edf2f7';
    addBtn.style.color = 'var(--primary-color)';
    addBtn.textContent = '➕ 新增常用項目';
    addBtn.onclick = () => {
        const newTag = prompt('請輸入新的標籤名稱：');
        if (newTag && newTag.trim()) {
            QUICK_TAGS.push(newTag.trim());
            localStorage.setItem('customQuickTags', JSON.stringify(QUICK_TAGS));
            renderQuickTags();
        }
    };
    container.appendChild(addBtn);
}

// 手動新增視窗
const manualModal = document.getElementById('manual-modal');
addManualBtn.addEventListener('click', () => {
    state.editingId = null;
    document.querySelector('#manual-modal h3').textContent = '➕ 雲端隨手記帳';
    
    const catSelect = document.getElementById('manual-cat');
    catSelect.innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
    document.getElementById('manual-details').value = "";
    document.getElementById('manual-amount').value = "";
    document.getElementById('manual-usage').value = "家用";
    
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    document.getElementById('manual-date').value = `${yyyy}-${mm}-${dd}`;
    
    renderQuickTags();
    manualModal.classList.add('active');
});

document.getElementById('cancel-manual-btn').addEventListener('click', () => {
    manualModal.classList.remove('active');
});

document.getElementById('confirm-manual-btn').addEventListener('click', async () => {
    const date = document.getElementById('manual-date').value.trim();
    const details = document.getElementById('manual-details').value.trim();
    const amountStr = document.getElementById('manual-amount').value.trim();
    const cat = document.getElementById('manual-cat').value;
    const usage = document.getElementById('manual-usage').value;
    
    let amountTWD = NaN;
    if (amountStr) {
        try {
            const safeStr = amountStr.replace(/[^0-9+\-*/.() ]/g, '');
            amountTWD = parseFloat(Function('"use strict";return (' + safeStr + ')')());
        } catch (e) { amountTWD = NaN; }
    }
    
    if (!date || !details || isNaN(amountTWD)) {
        alert("請確認所有欄位，且金額請輸入有效的數字或算式！");
        return;
    }

    // 禁用按鈕防連點
    const btn = document.getElementById('confirm-manual-btn');
    btn.disabled = true;
    btn.textContent = "上傳中...";

    try {
        if (state.editingId) {
            // 更新舊有紀錄
            await updateRecordInDb(state.editingId, {
                date: date,
                details: details,
                amountTWD: amountTWD,
                category: cat,
                usageType: usage
            });
            renderTable();
            manualModal.classList.remove('active');
        } else {
            // 新增紀錄
            const newRecord = {
                id: "m_" + Date.now(),
                month: state.currentMonth,
                bank: "手帳",
                date: date,
                details: details,
                amount_twd: amountTWD,
                amount_foreign: null,
                currency: "TWD",
                category: cat,
                usage_type: usage
            };

            const { error } = await supabaseClient.from('transactions').insert([newRecord]);
            if (error) throw error;
            
            // 更新畫面
            state.bankRecords.unshift({
                id: newRecord.id, month: newRecord.month, bank: newRecord.bank,
                date: newRecord.date, details: newRecord.details, amountTWD: newRecord.amount_twd,
                amountForeign: newRecord.amount_foreign, currency: newRecord.currency,
                category: newRecord.category, usageType: newRecord.usage_type
            });
            
            autoCategorizeBase();
            renderTable();
            updateSummary();
            manualModal.classList.remove('active');
        }
    } catch (error) {
        console.error("儲存失敗", error);
        alert("儲存失敗，請檢查網路連線。");
    } finally {
        btn.disabled = false;
        btn.textContent = "儲存至雲端";
    }
});

// 教學視窗控制
const helpModal = document.getElementById('help-modal');
document.getElementById('help-btn').addEventListener('click', () => {
    helpModal.classList.add('active');
});
document.getElementById('close-help-btn').addEventListener('click', () => {
    helpModal.classList.remove('active');
});

// ==================== 自動比對與衝突處理 ====================

// 執行自動比對
runMatchBtn.addEventListener('click', async () => {
    if (!state.ecommerceOrders || state.ecommerceOrders.length === 0) {
        alert("請先點擊右上角黃色的「📂 匯入資料檔 (JSON)」，匯入含有電商訂單的 JSON 檔後再執行自動比對！");
        return;
    }

    state.conflicts = [];
    
    // 找出需要比對的銀行紀錄 (關鍵字含蝦皮、酷澎、momo) 且尚未匹配的
    const targetRecords = state.bankRecords.filter(r => 
        /蝦皮|酷澎|momo/i.test(r.details) && !r.matchedOrder
    );

    if (targetRecords.length === 0) {
        alert('沒有找到需要比對的蝦皮、酷澎或 momo 紀錄，或者所有紀錄皆已完成配對！');
        return;
    }

    // 禁用按鈕顯示進行中
    runMatchBtn.disabled = true;
    runMatchBtn.innerHTML = '⏳ 正在執行自動比對...';

    try {
        for (const record of targetRecords) {
            // 尋找相同金額的電商訂單
            const matchedOrders = state.ecommerceOrders.filter(o => o.total === record.amountTWD && !o.isMatched);
            
            if (matchedOrders.length === 1) {
                // 單一符合，自動配對
                await matchRecordToOrder(record, matchedOrders[0]);
            } else if (matchedOrders.length > 1) {
                // 多個符合，加入衝突清單
                state.conflicts.push({
                    record: record,
                    options: matchedOrders
                });
            }
        }

        // 處理衝突
        if (state.conflicts.length > 0) {
            processNextConflict();
        } else {
            alert('比對完成！沒有遇到金額衝突。所有匹配結果已同步至雲端。');
            renderTable();
            updateSummary();
            setButtonDone();
        }
    } catch (e) {
        console.error("比對出錯：", e);
        alert("自動比對時發生錯誤，請重新整理頁面再試。");
        resetMatchButton();
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

// 配對銀行與訂單，並更新至 Supabase 雲端
async function matchRecordToOrder(record, order) {
    order.isMatched = true; // 標記為已配對，避免重複被其他紀錄匹配
    
    // 根據購買項目更新分類
    updateCategoryFromItems(record, order.items);
    
    // 更新至 Supabase 雲端
    await updateRecordInDb(record.id, {
        matchedOrder: order.id,
        category: record.category
    });
    
    // 建立本地 matchedItems 關聯，方便畫面即時渲染
    record.matchedItems = order.items;
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

// 處理衝突佇列
function processNextConflict() {
    if (state.conflicts.length === 0) {
        alert('所有衝突已處理完成！比對結果已同步至雲端。');
        renderTable();
        updateSummary();
        modal.classList.remove('active');
        setButtonDone();
        return;
    }

    state.currentConflict = state.conflicts.shift();
    const record = state.currentConflict.record;
    const options = state.currentConflict.options;

    document.getElementById('conflict-bank-detail').textContent = `${record.bank} (${record.details})`;
    document.getElementById('conflict-amount').textContent = `NT$ ${record.amountTWD}`;

    optionsContainer.innerHTML = '';
    options.forEach(opt => {
        const itemsText = opt.items.map(i => `${i.name} (單價: $${i.price}, 數量: ${i.qty})`).join(', ');
        const card = document.createElement('div');
        card.className = 'option-card';
        card.style.border = '1px solid #e2e8f0';
        card.style.borderRadius = '8px';
        card.style.padding = '1rem';
        card.style.marginBottom = '0.5rem';
        card.style.display = 'flex';
        card.style.justifyContent = 'space-between';
        card.style.alignItems = 'center';
        
        card.innerHTML = `
            <div class="option-info" style="flex: 1; padding-right: 1rem;">
                <h4 style="color: var(--primary-color); margin-bottom: 0.25rem;">${opt.platform} - 總額 $${opt.total} (日期: ${opt.date})</h4>
                <p style="font-size: 0.85rem; color: #4a5568;">項目: ${itemsText}</p>
            </div>
            <button class="primary-btn" style="padding: 0.5rem 1rem; font-size:0.85rem; white-space:nowrap;">選取此項</button>
        `;
        
        card.querySelector('button').addEventListener('click', async (e) => {
            // 禁用按鈕防連點
            e.target.disabled = true;
            e.target.textContent = '同步中...';
            
            await matchRecordToOrder(record, opt);
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
