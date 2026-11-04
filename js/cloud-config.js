/* cloud-config.js — 云服务公开配置
 * 由 workbuddy_cloud_service activate 返回的 publicConfig，可安全内置前端
 * （publishableKey 仅标识应用、本身不含权限；服务端按 Origin 精确匹配）。
 * 重新激活云服务后需同步更新此文件。
 */
window.CLOUD_CONFIG = {
  endpoint: "https://personal-site-12467.app.workbuddy.host",
  oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
  publishableKey: "wbpk_xoBlzc0wdzm7fsMRR5HjYm_s5Lg1DZqNK4jCJasR24Xwe44iajhEhAT"
};
