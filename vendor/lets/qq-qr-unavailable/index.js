/** No network, SDK imports, QR display, credential collection or persistence. */
const message = '当前版本暂不支持 QQ 扫码连接，请手动填写 AppID 和 AppSecret。'
export function startQrConnect() { throw new Error(message) }
export async function qrConnect() { throw new Error(message) }
