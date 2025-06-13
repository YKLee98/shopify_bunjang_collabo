const axios = require('axios');
const readline = require('readline');

// Shopify API 설정
const SHOPIFY_API_KEY = "67711a5b6f337db6676fb45dc69bf5b0";
const SHOPIFY_API_SECRET = "346f168440d662806ab7198f8e11d264";
const SHOPIFY_SHOP_DOMAIN = "hallyusuperstore19.myshopify.com";
const SHOPIFY_ADMIN_ACCESS_TOKEN = "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";
const SHOPIFY_API_VERSION = "2025-04";

// 대상 컬렉션과 위치
const COLLECTION_ID = "445888299257";  // bunjang_k-pop collection
const LOCATION_ID = "70693355769";     // Main warehouse

// API 엔드포인트
const BASE_URL = `https://${SHOPIFY_SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}`;
const HEADERS = {
    "X-Shopify-Access-Token": SHOPIFY_ADMIN_ACCESS_TOKEN,
    "Content-Type": "application/json"
};

// readline 인터페이스 설정
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// 간단한 GraphQL 쿼리로 제품 ID만 먼저 가져오기
async function getProductIdsFromCollection(collectionId) {
    console.log(`컬렉션의 제품 ID를 가져오는 중...`);
    
    const productIds = [];
    let cursor = null;
    
    while (true) {
        // 매우 간단한 쿼리 - 제품 ID만 가져옴
        const query = `
        {
            collection(id: "gid://shopify/Collection/${collectionId}") {
                title
                products(first: 100${cursor ? `, after: "${cursor}"` : ''}) {
                    edges {
                        node {
                            id
                            title
                        }
                        cursor
                    }
                    pageInfo {
                        hasNextPage
                    }
                }
            }
        }
        `;
        
        try {
            const response = await axios.post(
                `${BASE_URL}/graphql.json`,
                { query },
                { headers: HEADERS }
            );
            
            const data = response.data;
            
            if (data.errors) {
                console.error('GraphQL errors:', JSON.stringify(data.errors, null, 2));
                return [];
            }
            
            const collectionData = data.data?.collection;
            const productsData = collectionData?.products;
            
            if (!productsData) {
                console.error('컬렉션 데이터를 찾을 수 없습니다.');
                return [];
            }
            
            // 컬렉션 이름 출력
            if (productIds.length === 0 && collectionData?.title) {
                console.log(`컬렉션 이름: ${collectionData.title}`);
            }
            
            // 제품 정보 수집
            for (const edge of productsData.edges || []) {
                productIds.push({
                    id: edge.node.id,
                    title: edge.node.title
                });
            }
            
            console.log(`현재까지 가져온 제품 수: ${productIds.length}`);
            
            // 다음 페이지 확인
            if (!productsData.pageInfo?.hasNextPage) {
                break;
            }
            
            // 마지막 커서 가져오기
            const edges = productsData.edges || [];
            if (edges.length > 0) {
                cursor = edges[edges.length - 1].cursor;
            } else {
                break;
            }
            
        } catch (error) {
            console.error('제품 ID 가져오기 오류:', error.message);
            break;
        }
    }
    
    return productIds;
}

// 각 제품의 inventory 정보를 개별적으로 확인
async function checkProductInventory(productId) {
    const numericId = productId.split('/').pop();
    
    try {
        // REST API로 제품의 variant 정보 가져오기
        const productResponse = await axios.get(
            `${BASE_URL}/products/${numericId}.json`,
            { headers: HEADERS }
        );
        
        const product = productResponse.data.product;
        
        // 각 variant의 inventory level 확인
        for (const variant of product.variants) {
            const inventoryResponse = await axios.get(
                `${BASE_URL}/inventory_levels.json?inventory_item_ids=${variant.inventory_item_id}&location_ids=${LOCATION_ID}`,
                { headers: HEADERS }
            );
            
            const inventoryLevels = inventoryResponse.data.inventory_levels;
            
            // Main warehouse에 inventory가 있는지 확인
            if (inventoryLevels && inventoryLevels.length > 0) {
                return true;
            }
        }
        
        return false;
        
    } catch (error) {
        console.error(`제품 ${numericId} inventory 확인 오류:`, error.message);
        return false;
    }
}

// 제품 삭제
async function deleteProduct(productId) {
    const numericId = productId.split('/').pop();
    
    try {
        const response = await axios.delete(
            `${BASE_URL}/products/${numericId}.json`,
            { headers: HEADERS }
        );
        
        return response.status === 200;
    } catch (error) {
        console.error(`제품 ${numericId} 삭제 오류:`, error.message);
        return false;
    }
}

function askQuestion(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer);
        });
    });
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function saveProductList(products, filename) {
    const fs = require('fs');
    fs.writeFileSync(filename, JSON.stringify(products, null, 2));
    console.log(`제품 목록이 ${filename}에 저장되었습니다.`);
}

async function main() {
    try {
        console.log('=== Shopify 제품 삭제 스크립트 ===');
        console.log(`Shop: ${SHOPIFY_SHOP_DOMAIN}`);
        console.log(`API Version: ${SHOPIFY_API_VERSION}`);
        console.log(`Collection ID: ${COLLECTION_ID}`);
        console.log(`Location ID: ${LOCATION_ID} (Main warehouse)\n`);
        
        // 1단계: 컬렉션의 모든 제품 ID 가져오기
        const allProducts = await getProductIdsFromCollection(COLLECTION_ID);
        
        if (allProducts.length === 0) {
            console.log("\n컬렉션에 제품이 없습니다.");
            rl.close();
            return;
        }
        
        console.log(`\n총 ${allProducts.length}개의 제품을 찾았습니다.`);
        console.log("Main warehouse에 있는 제품을 확인하는 중...\n");
        
        // 2단계: 각 제품의 inventory 확인
        const productsToDelete = [];
        let checkedCount = 0;
        
        for (const product of allProducts) {
            checkedCount++;
            process.stdout.write(`[${checkedCount}/${allProducts.length}] ${product.title} 확인 중...`);
            
            const hasInventoryAtLocation = await checkProductInventory(product.id);
            
            if (hasInventoryAtLocation) {
                productsToDelete.push(product);
                console.log(' ✓ Main warehouse에 있음');
            } else {
                console.log(' - 다른 위치');
            }
            
            // API 속도 제한을 위한 대기
            await sleep(250);
        }
        
        if (productsToDelete.length === 0) {
            console.log("\nMain warehouse에 제품이 없습니다.");
            rl.close();
            return;
        }
        
        console.log(`\n=== Main warehouse에서 ${productsToDelete.length}개의 제품을 찾았습니다 ===\n`);
        
        // 제품 목록 표시
        productsToDelete.forEach((product, index) => {
            console.log(`${index + 1}. ${product.title}`);
        });
        
        // 백업 옵션
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFilename = `main_warehouse_products_${timestamp}.json`;
        await saveProductList(productsToDelete, backupFilename);
        
        // 최종 확인
        console.log(`\n⚠️  경고: 이 작업은 되돌릴 수 없습니다!`);
        console.log(`Main warehouse의 ${productsToDelete.length}개 제품이 영구적으로 삭제됩니다.`);
        const confirm = await askQuestion('\n정말로 삭제하시겠습니까? (yes/no): ');
        
        if (confirm.toLowerCase() !== 'yes') {
            console.log("\n삭제가 취소되었습니다.");
            rl.close();
            return;
        }
        
        console.log('\n제품 삭제를 시작합니다...\n');
        
        // 3단계: 제품 삭제
        let deletedCount = 0;
        let failedCount = 0;
        const failedProducts = [];
        
        for (let i = 0; i < productsToDelete.length; i++) {
            const product = productsToDelete[i];
            const progress = `[${i+1}/${productsToDelete.length}]`;
            
            process.stdout.write(`${progress} ${product.title} 삭제 중...`);
            
            if (await deleteProduct(product.id)) {
                deletedCount++;
                console.log(' ✓ 완료');
            } else {
                failedCount++;
                failedProducts.push(product);
                console.log(' ✗ 실패');
            }
            
            // API 속도 제한을 위한 대기
            await sleep(500);
        }
        
        console.log(`\n=== 삭제 완료 ===`);
        console.log(`✓ 성공: ${deletedCount}개`);
        console.log(`✗ 실패: ${failedCount}개`);
        
        if (failedProducts.length > 0) {
            const failedFilename = `failed_products_${timestamp}.json`;
            await saveProductList(failedProducts, failedFilename);
            console.log(`\n실패한 제품 목록이 ${failedFilename}에 저장되었습니다.`);
        }
        
    } catch (error) {
        console.error('\n메인 함수 오류:', error);
    } finally {
        rl.close();
    }
}

// 패키지 설치 확인
try {
    require('axios');
} catch (e) {
    console.log('=== 필수 패키지 설치 필요 ===');
    console.log('다음 명령어를 실행하여 필요한 패키지를 설치하세요:');
    console.log('\nnpm install axios');
    console.log('\n설치 후 다시 스크립트를 실행하세요.');
    process.exit(1);
}

// 스크립트 실행
main();