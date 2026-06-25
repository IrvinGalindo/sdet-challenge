export const FILES = {
  java: {
    'LoginTest.java': {
      lines: [
        'public class LoginTest {',
        '  private WebDriver driver;',
        '  private LoginPage loginPage;',
        '  @BeforeMethod',
        '  public void setUp() {',
        '    driver = new ChromeDriver();',
        '    driver.get("https://staging.example.com");',
        '    loginPage = new LoginPage(driver);',
        '  }',
        '  @Test',
        '  public void testValidLogin() {',
        '    loginPage.enterUsername("admin");',
        '    loginPage.enterPassword("admin123");',
        '    loginPage.clickLogin();',
        '    Assert.assertTrue(driver.getCurrentUrl().contains("/dashboard"));',
        '  }',
        '  @Test',
        '  public void testInvalidLogin() {',
        '    loginPage.enterUsername("wrong@test.com");',
        '    loginPage.enterPassword("wrongpass");',
        '    loginPage.clickLogin();',
        '    String actual = loginPage.getErrorMessage();',
        '    Assert.assertEquals(actual, "Invalid credentials");',
        '  }',
        '  @AfterMethod',
        '  public void tearDown() {',
        '    if (driver != null) driver = null;',
        '  }',
        '}',
      ],
      bugs: {
        1:  '[Architecture] [Senior] Bug: LoginTest manages WebDriver directly. Tests should inherit from a BaseTest class to abstract setup and teardown logic.',
        6:  '[Environment] [Mid] Bug: new ChromeDriver() — no WebDriverManager, no ChromeOptions. Driver version mismatch causes runtime failures.',
        13: '[Security] [Junior] Bug: Hardcoded password "admin123" in test source. Must come from environment variables or a secrets manager.',
        23: '[Best Practice] [Mid] Bug: Assert.assertEquals(actual, "Invalid credentials") — argument order is wrong. TestNG expects (expected, actual), so failure messages are misleading.',
        27: '[Performance] [Mid] Bug: tearDown sets driver = null but never calls driver.quit(). Browser process leaks on every test run.',
      }
    },
    'BasePage.java': {
      lines: [
        'public class BasePage {',
        '  protected WebDriver driver;',
        '  protected WebDriverWait wait;',
        '  public BasePage(WebDriver driver) {',
        '    this.driver = driver;',
        '    this.wait = new WebDriverWait(driver, Duration.ofSeconds(2));',
        '    PageFactory.initElements(driver, this);',
        '  }',
        '  public void clickElement(WebElement el) {',
        '    el.click();',
        '  }',
        '  public boolean isDisplayed(WebElement el) {',
        '    try { return el.isDisplayed(); }',
        '    catch (NoSuchElementException e) { return false; }',
        '  }',
        '}',
      ],
      bugs: {
        6:  '[Flakiness] [Junior] Bug: WebDriverWait timeout is 2 seconds — too low for any real app on CI. Minimum recommended is 10s.',
        10: '[Flakiness] [Mid] Bug: el.click() with no wait — element may be in DOM but not yet interactable. Use ExpectedConditions.elementToBeClickable() first.',
        12: '[Performance] [Senior] Bug: If PageFactory implicit wait is active, catching NoSuchElementException makes isDisplayed() extremely slow when an element is not present.',
      }
    },
    'ApiClient.java': {
      lines: [
        'public class ApiClient {',
        '  private static final String BASE_URL = "http://api.example.com";',
        '  public Response post(String endpoint, String body) {',
        '    return given()',
        '      .body(body)',
        '      .post(BASE_URL + endpoint);',
        '  }',
        '  public boolean isSuccess(Response res) {',
        '    return res.getStatusCode() == 200;',
        '  }',
        '}',
      ],
      bugs: {
        2: '[Security] [Junior] Bug: BASE_URL uses http:// — plain unencrypted HTTP. Will fail on TLS-only servers.',
        5: '[Architecture] [Mid] Bug: POST has no Content-Type header. Without .contentType(ContentType.JSON) the server may reject the body.',
        9: '[Architecture] [Senior] Bug: isSuccess only checks status 200. HTTP 201 (Created) and 204 (No Content) will wrongly return false.',
      }
    },
    'TestConfig.java': {
      lines: [
        'public class TestConfig {',
        '  private static final String BASE_URL = "http://staging.example.com";',
        '  private static final String PASSWORD  = "P@ssword123";',
        '  public String getBaseUrl()  { return BASE_URL; }',
        '  public String getPassword() { return PASSWORD; }',
        '  public int getTimeout()     { return 30; }',
        '}',
      ],
      bugs: {
        2: '[Security] [Junior] Bug: BASE_URL is http:// — staging must use TLS to match production security settings.',
        3: '[Security] [Junior] Bug: PASSWORD hardcoded as a string literal in source. Gets committed to version control — use System.getenv() or a vault.',
      }
    },
    'pom.xml': {
      lines: [
        '<project>',
        '  <dependencies>',
        '    <dependency>',
        '      <groupId>org.seleniumhq.selenium</groupId>',
        '      <artifactId>selenium-java</artifactId>',
        '      <version>LATEST</version>',
        '    </dependency>',
        '    <dependency>',
        '      <groupId>org.testng</groupId>',
        '      <artifactId>testng</artifactId>',
        '      <version>7.9.0</version>',
        '    </dependency>',
        '  </dependencies>',
        '</project>',
      ],
      bugs: {
        6: '[CI/CD] [Senior] Bug: Selenium version is "LATEST" — unpinned. A new release can silently break all tests in CI.',
      }
    },
    'StringUtils.java': {
      lines: [
        'package helpers;',
        '',
        'public class StringUtils {',
        '  public static String generateRandomEmail() {',
        '    return "test" + Math.random() + "@domain.com";',
        '  }',
        '  public static boolean isEmpty(String str) {',
        '    return str.length() == 0;',
        '  }',
        '}'
      ],
      bugs: {
        1: '[Architecture] [Tech Lead] Bug: Package name "helpers" does not match folder structure "utils". Modifiers and loaders will fail.',
        8: '[Architecture] [Mid] Bug: str.length() == 0 will throw NullPointerException if str is null. Need str == null || str.length() == 0.'
      }
    },
    'DBUtils.java': {
      lines: [
        'package utils;',
        '',
        'import java.sql.*;',
        '',
        'public class DBUtils {',
        '  public static ResultSet executeQuery(String query) throws Exception {',
        '    Connection conn = DriverManager.getConnection("jdbc:mysql://localhost:3306/db", "root", "root");',
        '    Statement stmt = conn.createStatement();',
        '    return stmt.executeQuery(query);',
        '  }',
        '}'
      ],
      bugs: {
        7: '[Security] [Junior] Bug: Hardcoded database connection. Credentials must be externally vaulted, not embedded in JDBC strings.',
        9: '[Performance] [Tech Lead] Bug: JDBC Connection, Statement, and ResultSet are leaked. They are never closed, leading to immediate thread pool exhaustion.'
      }
    }
  },
  js: {
    'login.test.js': {
      fileBugs: { file: '[Best Practice] [Mid] Bug: Login test file does not follow the project standard suffix .spec.js for Playwright.' },
      lines: [
        "const { test, expect } = require('@playwright/test');",
        "test.describe('Login suite', () => {",
        "  test.beforeEach(async ({ page }) => {",
        "    await page.goto('http://staging.example.com');",
        "  });",
        "  test('valid login', async ({ page }) => {",
        "    await page.fill('#username', 'admin');",
        "    await page.fill('#password', 'admin123');",
        "    await page.click('#login-btn');",
        "    await expect(page).toHaveURL('/dashboard');",
        "  });",
        "  test('invalid login', async ({ page }) => {",
        "    await page.fill('#username', 'bad@test.com');",
        "    await page.fill('#password', 'wrongpass');",
        "    await page.click('#login-btn');",
        "    const msg = await page.textContent('.error-msg');",
        "    expect(msg).toBe('Wrong credentials');",
        "  });",
        "});",
      ],
      bugs: {
        4:  '[Security] [Mid] Bug: page.goto uses http:// — Secure cookies will not be set and some auth flows will silently fail.',
        7:  '[Architecture] [Mid] Bug: Hardcoding UI selectors directly in tests violates the Page Object Model (POM) pattern.',
        8:  '[Security] [Junior] Bug: Hardcoded password "admin123" in test source. Must be read from process.env.',
        9:  '[Best Practice] [Senior] Bug: Using generic CSS selectors like "#login-btn". Playwright recommends user-facing locators (e.g. getByRole).',
        17: '[Flakiness] [Mid] Bug: expect(msg).toBe("Wrong credentials") — brittle hardcoded string. Will break if copy changes.',
      }
    },
    'basePage.js': {
      lines: [
        "class BasePage {",
        "  constructor(page) {",
        "    this.page = page;",
        "    this.defaultTimeout = 2000;",
        "  }",
        "  async clickElement(selector) {",
        "    await this.page.locator(selector).click();",
        "  }",
        "  async getText(selector) {",
        "    return await this.page.textContent(selector);",
        "  }",
        "  async isVisible(selector) {",
        "    return await this.page.locator(selector).isVisible();",
        "  }",
        "}",
        "module.exports = BasePage;",
      ],
      bugs: {
        4: '[Flakiness] [Junior] Bug: defaultTimeout is 2000ms — too low for real apps on CI. Should be at least 10000ms.',
        7: '[Flakiness] [Mid] Bug: locator.click() with no waitFor. Should call waitFor({ state: "visible" }) first.',
        12: '[Flakiness] [Senior] Bug: isVisible() does not auto-wait! It returns immediately. Use expect().toBeVisible() or .waitFor({ state: "visible" }).',
      }
    },
    'apiClient.js': {
      lines: [
        "const axios = require('axios');",
        "const BASE_URL = 'http://api.example.com';",
        "async function post(endpoint, body) {",
        "  const res = await axios.post(BASE_URL + endpoint, body);",
        "  return res;",
        "}",
        "async function isSuccess(res) {",
        "  return res.status === 200;",
        "}",
        "module.exports = { post, isSuccess };",
      ],
      bugs: {
        2: '[Security] [Junior] Bug: BASE_URL uses http:// — plain HTTP. Will fail against any server enforcing HTTPS-only.',
        4: '[Architecture] [Senior] Bug: axios throws exceptions on 4xx/5xx by default. This will crash the test suite instead of returning the response object. Requires try/catch or validateStatus config.',
        8: '[Architecture] [Senior] Bug: isSuccess checks only res.status === 200. HTTP 201 and 204 will wrongly return false.',
      }
    },
    'config.js': {
      lines: [
        "module.exports = {",
        "  baseUrl:  'http://staging.example.com',",
        "  password: 'P@ssword123',",
        "  timeout:  30000,",
        "  browser:  'chromium',",
        "};",
      ],
      bugs: {
        2: '[Security] [Junior] Bug: baseUrl uses http:// — staging must mirror production TLS settings.',
        3: '[Security] [Junior] Bug: password hardcoded in a committed config file. Must be process.env.TEST_PASSWORD.',
      }
    },
    'package.json': {
      lines: [
        '{',
        '  "dependencies": {',
        '    "axios": "*",',
        '    "@playwright/test": "1.42.0",',
        '    "dotenv": "^16.0.0"',
        '  },',
        '  "scripts": {',
        '    "test": "playwright test"',
        '  }',
        '}',
      ],
      bugs: {
        2: '[Best Practice] [Mid] Bug: Test frameworks (Playwright) should be in "devDependencies" so they aren\'t shipped to production environments.',
        3: '[CI/CD] [Senior] Bug: axios version is "*" — completely unpinned. Any breaking major release silently breaks all API tests.',
      }
    },
    'testHelper.js': {
      lines: [
        'const fs = require("fs");',
        '',
        'function readTestData(filePath) {',
        '  const data = fs.readFileSync(filePath, "utf-8");',
        '  return JSON.parse(data);',
        '}',
        '',
        'function getRandomEmail() {',
        '  return "test" + Math.random() + "@example.com";',
        '}',
        '',
        'module.exports = { readTestData, getRandomEmail };'
      ],
      bugs: {
        4: '[Architecture] [Mid] Bug: readFileSync and JSON.parse can throw errors. Missing try-catch block to handle invalid JSON or missing files.'
      }
    },
    'dateUtils.js': {
      lines: [
        'function getFutureDate(days) {',
        '  const d = new Date();',
        '  d.setDate(d.getDate() + days);',
        '  return d.toISOString().split("T")[0];',
        '}',
        '',
        'function isWeekend(dateStr) {',
        '  const d = new Date(dateStr);',
        '  return d.getDay() === 0 || d.getDay() === 6;',
        '}',
        '',
        'module.exports = { getFutureDate, isWeekend };'
      ],
      bugs: {
        8: '[Flakiness] [Tech Lead] Bug: new Date(dateStr) parsing is inconsistent across browsers/environments without a strict ISO format or a library like Moment/date-fns.'
      }
    }
  }
};

export const TREES = {
  java: [
    { label: 'src/test/java', children: ['LoginTest.java', 'BasePage.java', 'ApiClient.java', 'TestConfig.java'] },
    { label: 'src/test/java/utils', children: ['StringUtils.java', 'DBUtils.java'] },
    { 
      label: 'config', 
      children: ['pom.xml'],
      bugs: { folder: '[Architecture] [Senior] Bug: Maven pom.xml belongs in the project root directory, not hidden inside a "config" wrapper.' }
    }
  ],
  js: [
    { label: 'tests', children: ['login.test.js', 'basePage.js', 'apiClient.js', 'config.js'] },
    { 
      label: 'tests/helpers', 
      children: ['testHelper.js'],
      bugs: { folder: '[Architecture] [Senior] Bug: Helper folder is missing an index.js entry point making imports cumbersome.' }
    },
    { label: 'tests/utils', children: ['dateUtils.js'] },
    { label: 'config', children: ['package.json'] }
  ]
};
