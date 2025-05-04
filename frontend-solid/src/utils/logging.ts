export const whitelistLogTags = (whitelist: string[]) => ({
  whitelist: whitelist,
  createTaggedLogger: (tag: string) => (
    whitelist.includes(tag)
      ? (...message: any) => { console.log(message); }
      : (..._: any) => {}
  ),
});
