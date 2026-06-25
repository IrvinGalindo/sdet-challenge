export const QUIZZES = {
  restassured: {
    id: 'restassured',
    title: 'REST Assured Challenge',
    icon: '🔗',
    topic: 'API Testing',
    description: 'Analyze a REST Assured test suite and answer questions about its behavior, best practices, and failure scenarios.',
    snippet: `public class RandomRestAssured {

  @Test(priority = 1)
  public void randomOne() {
    Dude someDude = new Dude("John", "Doe", 45);
    given().
      body(someDude).
    when().
      post("http://localhost:6060/database/dudes").
    then().
      statusCode(201);
  }

  @Test(priority = 2)
  public void randomTwo() {
    when().
      get("http://localhost:6060/database/dudes/1").
    then().
      statusCode(200);
  }

  @Test(priority = 3)
  public void randomThree() {
    when().
      get("http://localhost:6060/database/dudes/1").
    then().
      body("firstName", equalTo("John")).
      body("lastName", equalTo("Doe")).
      body("age", equalTo(45));
  }
}`,
    language: 'java',
    questions: [
      {
        id: 'ra-1',
        question: 'What is this test suite trying to do?',
        options: [
          { label: 'A', text: 'Create a record via POST, verify it exists via GET, then validate its field values via a second GET.', correct: true, explanation: 'Correct! The 3 tests form a lifecycle scenario: (1) POST creates the Dude, (2) GET confirms retrieval returns 200, (3) GET validates the exact field values match what was posted.' },
          { label: 'B', text: 'Execute 3 independent GET requests to validate a pre-seeded database state.', correct: false, explanation: 'Incorrect. Test 1 uses POST to create a record. Tests 2 and 3 depend on that record being created successfully — they are not independent.' },
          { label: 'C', text: 'Test that the API returns a 201 and 200 for all endpoints regardless of payload.', correct: false, explanation: 'Incorrect. The tests are specifically testing the flow of creating and then fetching the exact Dude object — not generic status code behavior.' },
          { label: 'D', text: 'Validate that the Dude class serialization to JSON is working correctly on the client side.', correct: false, explanation: 'Incorrect. The test does not assert or inspect the request payload — it asserts server responses, specifically the status codes and response body field values.' },
        ]
      },
      {
        id: 'ra-2',
        question: 'How would you log the POST response ONLY when it fails?',
        options: [
          { label: 'A', text: 'Add .log().all() before the .when() block to always log everything.', correct: false, explanation: 'Incorrect. .log().all() logs unconditionally on every run, which adds noise and is not the "only on failure" pattern.' },
          { label: 'B', text: 'Wrap the test in a try/catch and print the response in the catch block.', correct: false, explanation: 'Incorrect. This pattern catches Java exceptions, not assertion failures within RestAssured\'s fluent chain. The statusCode() assertion throws AssertionError, not always caught correctly this way.' },
          { label: 'C', text: 'Use .log().ifValidationFails() in the request specification before .then().', correct: true, explanation: 'Correct! RestAssured provides .log().ifValidationFails() specifically for this purpose. It only emits the log output when an assertion in the .then() block fails — zero noise on passing runs.' },
          { label: 'D', text: 'Use a TestNG listener\'s onTestFailure() method to read and print the last response.', correct: false, explanation: 'Partially valid — listeners can help, but they do not have easy access to the RestAssured response object after the chain completes. .log().ifValidationFails() is the idiomatic RestAssured solution.' },
        ]
      },
      {
        id: 'ra-3',
        question: 'What would be the response status of the GET in randomTwo() IF randomOne() (the POST) failed?',
        options: [
          { label: 'A', text: '201 Created — the GET always returns 201 because the endpoint is the same.', correct: false, explanation: 'Incorrect. 201 is only returned by the POST endpoint on successful creation. A GET to /database/dudes/1 returns 200 if the record exists, not 201.' },
          { label: 'B', text: '200 OK — GET requests always succeed regardless of application state.', correct: false, explanation: 'Incorrect. GET returns 200 only if the resource exists. If the POST failed, the resource was never persisted, so the GET would likely return 404.' },
          { label: 'C', text: '404 Not Found — the POST failed, so no resource was persisted and the subsequent GET finds nothing.', correct: true, explanation: 'Correct! If randomOne() fails, the Dude with ID 1 was never persisted. A GET to /database/dudes/1 would return 404, causing randomTwo() to also fail with an unexpected status code.' },
          { label: 'D', text: '500 Internal Server Error — a failed POST always puts the server into an error state.', correct: false, explanation: 'Incorrect. A failed POST response does not inherently corrupt server state. The server simply did not persist the record. A subsequent GET would return 404, not 500.' },
        ]
      },
      {
        id: 'ra-4',
        question: 'What would randomThree() do if randomOne() failed? Will it succeed?',
        options: [
          { label: 'A', text: 'It will succeed — it uses a separate GET that does not depend on the POST.', correct: false, explanation: 'Incorrect. randomThree() fetches /database/dudes/1 and asserts specific field values. If the POST never ran, ID 1 does not exist, and the GET will return 404 — the body assertions will not even be evaluated.' },
          { label: 'B', text: 'It will fail with a NullPointerException because body() cannot parse a null response.', correct: false, explanation: 'Close, but not precise. RestAssured will throw an assertion error on the statusCode or body mismatch — not a NullPointerException specifically. The response body for a 404 would not match "John".' },
          { label: 'C', text: 'It will fail — the record does not exist so the GET returns 404, and the body assertions for firstName, lastName, and age will all fail.', correct: true, explanation: 'Correct! Since the POST in randomOne() failed, the Dude record was never saved. randomThree()\'s GET returns 404, and all three body() assertions (firstName, lastName, age) will fail because the expected values are not present.' },
          { label: 'D', text: 'It depends on TestNG priority — if TestNG skips randomThree() due to dependency failure, it would be marked as skipped, not failed.', correct: false, explanation: 'This would be true ONLY if you add dependsOnMethods = "randomOne" to randomThree()\'s @Test annotation. As written, TestNG simply runs all @Test methods in priority order with no declared dependencies, so randomThree() will run and actively fail.' },
        ]
      }
    ]
  },

  sql: {
    id: 'sql',
    title: 'SQL Challenge',
    icon: '🗄️',
    topic: 'Database Queries',
    description: 'Analyze a SQL schema with INSERT and SELECT queries and answer questions about joins, aggregations, and NULL behavior.',
    snippet: `CREATE TABLE Departments (
    DepartmentID INT PRIMARY KEY,
    DepartmentName VARCHAR(100)
);

CREATE TABLE Employees (
    EmployeeID INT PRIMARY KEY,
    Name VARCHAR(100),
    DepartmentID INT,
    Salary DECIMAL(10, 2),
    FOREIGN KEY (DepartmentID) REFERENCES Departments(DepartmentID)
);

-- Departments
INSERT INTO Departments VALUES
  (1, 'Engineering'), (2, 'HR'), (3, 'Marketing');

-- Employees
INSERT INTO Employees VALUES
  (101, 'Alice', 1, 90000),
  (102, 'Bob',   1, 85000),
  (103, 'Charlie', 2, 60000),
  (104, 'Diana', 3, 70000),
  (105, 'Eve',  NULL, 50000); -- No department

-- Query 1: List employees with department names
SELECT e.Name, d.DepartmentName
FROM Employees e
LEFT JOIN Departments d ON e.DepartmentID = d.DepartmentID;

-- Query 2: Average salary per department
SELECT d.DepartmentName, AVG(e.Salary) AS AvgSalary
FROM Employees e
JOIN Departments d ON e.DepartmentID = d.DepartmentID
GROUP BY d.DepartmentName;`,
    language: 'sql',
    questions: [
      {
        id: 'sql-1',
        question: "Eve's DepartmentID is NULL. What does this represent, and is the INSERT valid?",
        options: [
          { label: 'A', text: 'It is invalid — a NULL foreign key violates referential integrity and the INSERT will be rejected.', correct: false, explanation: 'Incorrect. Most databases (including MySQL and PostgreSQL) allow NULL values in a foreign key column by default. A NULL FK means the relationship is absent — not that it references a non-existent row. Referential integrity is only enforced for non-NULL FK values.' },
          { label: 'B', text: 'It is valid — NULL in a foreign key column is allowed and simply means Eve has no department yet.', correct: true, explanation: 'Correct! NULL foreign keys are explicitly allowed in standard SQL. They represent an optional relationship — Eve simply has no department assigned yet. The FK constraint only applies when a non-NULL value is provided.' },
          { label: 'C', text: "It is invalid — Eve's row needs a default DepartmentID like 0 to be safely inserted.", correct: false, explanation: "Incorrect. Using 0 as a default would be worse — 0 doesn't exist in the Departments table, which WOULD violate referential integrity. NULL is the correct way to represent 'no department'." },
          { label: 'D', text: 'It is valid, but Eve will appear in ALL department groups when aggregations are run.', correct: false, explanation: "Incorrect. NULL FK means Eve is excluded from INNER JOINs with Departments. She does NOT appear in any department group — she is simply absent from grouped aggregation results unless a LEFT JOIN is used." },
        ]
      },
      {
        id: 'sql-2',
        question: 'Query 1 uses LEFT JOIN. How many rows does it return, and what value appears for Eve\'s DepartmentName?',
        options: [
          { label: 'A', text: '4 rows — Eve is excluded because her DepartmentID is NULL and LEFT JOIN skips NULLs.', correct: false, explanation: 'Incorrect. That is the behavior of an INNER JOIN. A LEFT JOIN keeps ALL rows from the left table (Employees), even if there is no matching row on the right (Departments).' },
          { label: 'B', text: '5 rows — LEFT JOIN keeps all 5 employees, so Eve appears with NULL as her DepartmentName.', correct: true, explanation: 'Correct! LEFT JOIN returns all 5 employees. For Eve, since her DepartmentID is NULL, there is no match in Departments, so d.DepartmentName is NULL in her row. All 5 employees are present.' },
          { label: 'C', text: '5 rows — Eve is included with an empty string (\'\') as her DepartmentName.', correct: false, explanation: "Incorrect. SQL LEFT JOIN produces NULL for unmatched columns — not an empty string. The value is NULL, which is distinct from '' in SQL comparisons." },
          { label: 'D', text: "5 rows — Eve is included and her DepartmentName shows 'Unassigned' automatically.", correct: false, explanation: "Incorrect. SQL does not auto-label NULLs. You would need to explicitly use COALESCE(d.DepartmentName, 'Unassigned') in the SELECT clause to achieve this output." },
        ]
      },
      {
        id: 'sql-3',
        question: "Query 2 uses INNER JOIN. How many groups does it return, and what happens to Eve's salary?",
        options: [
          { label: 'A', text: '4 groups — Eve\'s salary is included in a special NULL group.', correct: false, explanation: "Incorrect. INNER JOIN only includes rows where a match exists in both tables. Eve has NULL DepartmentID, so she has no match in Departments — she is completely excluded, and there is no NULL group." },
          { label: 'B', text: '3 groups — INNER JOIN drops Eve since her DepartmentID has no match in Departments. Her salary is excluded from all averages.', correct: true, explanation: "Correct! The INNER JOIN (JOIN without LEFT) drops Eve entirely because her DepartmentID is NULL — no match exists. Only 3 groups are returned: Engineering (AVG of Alice+Bob = 87,500), HR (Charlie = 60,000), Marketing (Diana = 70,000). Eve's $50,000 is lost from the average." },
          { label: 'C', text: '3 groups — Eve\'s salary is averaged into the Engineering group as the default.', correct: false, explanation: "Incorrect. Eve has no DepartmentID, so she cannot be assigned to Engineering or any other group implicitly. INNER JOIN drops her row entirely — her salary contributes to no average." },
          { label: 'D', text: '3 groups — Eve\'s salary is distributed proportionally across all department averages.', correct: false, explanation: "Incorrect. SQL does not redistribute NULL-FK rows. Eve is simply excluded from the INNER JOIN result set. Her salary has zero influence on any group's AVG calculation." },
        ]
      }
    ]
  }
};
