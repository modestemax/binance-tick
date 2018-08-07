const debug = require('debug')('trade');
const _ = require('lodash');
const { strategies, exchangeIds } = require('common/settings');
const { auth, loadOrders, saveOder,saveSellOder, delOder,/* delExpiredOrders,*/ saveTrade, loadOrder, computeChange,
    getFreeBalance, loadMarkets, loadTrades, saveBalances, loadOrderStrategy, publish } = require('common');


const Binance = require('binance-api-node').default;
const client = Binance({ apiKey: auth.api_key, apiSecret: auth.secret });

start();

async function start() {
    delExpiredOrders();
    onUserData();
    (await loadTrades()).forEach(observeTrade);
    debug('started')
}

function delExpiredOrders() {
    _.forEach(loadOrders(), delExpiredOrder)
}

async function delExpiredOrder(order, strategy) {
    let { orderTime, orderId } = order;
    let now = Date.now();
    strategy = strategy || await loadOrderStrategy(order);

    let { cancelBidAfterSecond } = strategy;
    if (now - orderTime > cancelBidAfterSecond * 1e3) {
        publish('cancelOrder', JSON.stringify(order))
    } else {
        delExpiredOrder[orderId] = setTimeout(() => delExpiredOrder(order, strategy),
            (orderTime + cancelBidAfterSecond * 1e3) - now)
    }

}
function createOrder(order) {
    saveOder(order);
    delExpiredOrder(order);
}
function createSellOrder(order) {
    saveSellOder(order);
}
function deleteOrder(order) {
    delOder(order);
    clearInterval(delExpiredOrder[order.orderId]);
    delete delExpiredOrder[order.orderId];
}

function listenTick(symbol, onTick) {
    client.ws.ticker([symbol], onTick);
}

function onUserData() {
    client.ws.user(async msg => {
        switch (msg.eventType) {
            case "executionReport":
                const order = Object.assign({ symbolId: msg.symbol }, msg);
                delete order.symbol;
                switch (msg.side) {
                    case 'BUY':
                        switch (msg.orderStatus) {
                            case 'NEW':
                                //new order           
                                debug('new order detected ' + order.symbolId);
                                createOrder(order)
                                break;
                            case 'FILLED':
                                //filled bid                      
                                await saveTrade(order);
                                deleteOrder(order)
                                observeTrade(order);
                                publish('newTrade', order.newClientOrderId);
                                break;
                            case 'EXPIRED':
                                //filled bid
                                debug('order expired ' + order.symbolId);
                                deleteOrder(order)
                                break;
                            case 'CANCELED':
                                debug('order CANCELED ' + order.symbolId);
                                order.newClientOrderId = msg.originalClientOrderId;
                                deleteOrder(order)
                                break;

                        }
                        break;
                    case 'SELL':
                        switch (msg.orderStatus) {
                            case 'NEW':
                                //new order           
                                debug('new sell order detected ' + order.symbolId);
                                createSellOrder(order)
                                break;
                        }
                        break;
                }
                break;
            case "account":
                saveBalances('binance',msg.balances);
                break;
        }
    });
}

async function observeTrade(trade) {
    listenTick(trade.symbol, tick => {
        trade.lastPrice = tick.price;
        trade.change = computeChange(trade.bid, tick.price);

        if (!trade.maxChange || trade.maxChange < trade.change) {
            trade.maxChange = trade.change;
        }
        if (!trade.minChange || trade.minChange > trade.change) {
            trade.maxChange = trade.change;
        }
        saveTrade(trade)
        publish('tradeChanged', JSON.stringify(trade))
    });
}
