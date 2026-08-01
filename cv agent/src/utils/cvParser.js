// Advanced AI CV Copywriter & Data Extraction Engine - CV Agent by Nexus
export function extractCVData(currentData, userMessage, step) {
  let updatedData = { ...currentData };
  let nextStep = step;
  let responseMessage = "";

  switch (step) {
    case 0:
      updatedData.fullName = userMessage;
      nextStep = 1;
      responseMessage = `A pleasure, ${userMessage}! What is your current field of study, major, or target professional role? (e.g., Software Engineering Student, Full-Stack Developer, Data Analyst)`;
      break;

    case 1: {
      let inputLower = userMessage.toLowerCase();
      let enhancedProfession = userMessage;
      let extraSummary = "";

      if (inputLower.includes("student") || inputLower.includes("academic") || inputLower.includes("computer science") || inputLower.includes("university")) {
        enhancedProfession = `${userMessage} | Ambitious Academic Scholar`;
        extraSummary = "Dedicated and high-performing student with a rigorous academic foundation, driven by a passion for continuous learning, technical innovation, and collaborative problem-solving in dynamic environments.";
      } else if (inputLower.includes("developer") || inputLower.includes("engineer") || inputLower.includes("software") || inputLower.includes("coder")) {
        enhancedProfession = `${userMessage} | Software Engineering Professional`;
        extraSummary = "Results-driven Software Engineer specialized in designing, building, and scaling modern digital applications using cutting-edge tech stacks and clean architecture principles.";
      } else {
        enhancedProfession = `${userMessage} | Dedicated Industry Professional`;
        extraSummary = "Goal-oriented professional committed to delivering high-impact operational solutions, driving project excellence, and contributing to cross-functional team success.";
      }

      updatedData.profession = enhancedProfession;
      updatedData.summary = extraSummary;
      nextStep = 2;
      responseMessage = "Outstanding! I've engineered a compelling professional summary and profile header for you. Now, list your core technical & professional skills (comma-separated):";
      break;
    }

    case 2:
      updatedData.skills = userMessage.split(',').map(s => s.trim()).filter(Boolean);
      nextStep = 3;
      responseMessage = "Fantastic skill set! Finally, share your key work experiences, major academic projects, or notable achievements:";
      break;

    case 3:
      updatedData.experience = userMessage;
      nextStep = 4;
      responseMessage = "Incredible! Your executive-level CV has been fully generated, structured, and enriched. You can review the live preview and customize its layout/colors.";
      break;

    default:
      responseMessage = "Your CV profile is completely up-to-date and ready for export!";
  }

  return { updatedData, nextStep, responseMessage };
}