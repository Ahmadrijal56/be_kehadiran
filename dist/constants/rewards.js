export const REWARD_AMOUNTS_IDR = {
    top_1: 100_000,
    top_2: 50_000,
    top_3: 25_000,
};
export function rewardAmountForType(type) {
    if (type === "top_1")
        return REWARD_AMOUNTS_IDR.top_1;
    if (type === "top_2")
        return REWARD_AMOUNTS_IDR.top_2;
    if (type === "top_3")
        return REWARD_AMOUNTS_IDR.top_3;
    if (type === "eotm")
        return REWARD_AMOUNTS_IDR.top_1;
    return null;
}
//# sourceMappingURL=rewards.js.map