import { detectLanguage } from './language';

describe('detectLanguage', () => {
  it.each([
    ['NestJS, PostgreSQL və Kubernetes ilə backend xidmətləri. Namizəd üçün tələblər: təcrübə.', 'az'],
    ['Backend developer wanted. You will build services with our team. Requirements and responsibilities.', 'en'],
    ['Требуется разработчик backend. Опыт работы с PostgreSQL и NestJS.', 'ru'],
    ['Backend geliştirici aranıyor. Bir şirket için deneyim ve pozisyon gereken.', 'tr'],
    ['', 'en'],
    ['12345 !!!', 'en'],
  ])('detects %j as %s', (text, expected) => expect(detectLanguage(text)).toBe(expected));
});
