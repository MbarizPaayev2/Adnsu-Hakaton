import { frontendOrigins } from './cors-origins';

it('allows both owned public hosts, with no wildcard or unrelated origins', () => {
  expect(frontendOrigins('https://aisehr.com')).toEqual(['https://aisehr.com', 'https://www.aisehr.com']);
  expect(frontendOrigins('https://www.aisehr.com')).toEqual(['https://www.aisehr.com', 'https://aisehr.com']);
  expect(frontendOrigins('https://aisehr.com.attacker.example')).toEqual(['https://aisehr.com.attacker.example']);
  expect(frontendOrigins('https://aisehr.com:9443')).toEqual(['https://aisehr.com:9443']);
  expect(frontendOrigins()).toEqual(['http://localhost:3000']);
  expect(() => frontendOrigins('https://user:password@aisehr.com')).toThrow('Invalid FRONTEND_URL');
});
