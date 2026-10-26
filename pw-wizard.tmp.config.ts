import base from "./playwright.config";
export default { ...base, use: { ...base.use, baseURL: "http://127.0.0.1:5177" } };
