export default jest.fn(() => Promise.resolve({
  text: () => Promise.resolve(''),
  json: () => Promise.resolve({}),
}));
