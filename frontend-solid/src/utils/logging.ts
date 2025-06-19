const whitelistLogTags = (whitelist: string[]) => ({
  whitelist: whitelist,
  createTaggedLogger: (tag: string) => (
    whitelist.includes(tag)
      ? (...message: any) => { console.log(message); }
      : (..._: any) => {}
  ),
});

//const logging = whitelistLogTags(["stage1", "stage2"]);
const logging = whitelistLogTags(["stage1", "stage2"]);

export const log1stage = logging.createTaggedLogger("stage1");
export const log2stage = logging.createTaggedLogger("stage2");