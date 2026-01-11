
import { GoogleGenAI, Type } from "@google/genai";
import { Pose, MatchResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function evaluatePose(base64Image: string, targetPose: Pose): Promise<MatchResult> {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Image
            }
          },
          {
            text: `You are a judge for the game "Hole in the Wall". 
            The target pose is: "${targetPose.name}". 
            Description: "${targetPose.description}". 
            Look at the person in the image and determine if they are accurately mimicking this pose.
            Be slightly lenient but ensure the core shape is there.
            Return a JSON object with:
            - matched: boolean
            - score: number (0 to 100)
            - feedback: string (short encouraging message)`
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            matched: { type: Type.BOOLEAN },
            score: { type: Type.NUMBER },
            feedback: { type: Type.STRING }
          },
          required: ["matched", "score", "feedback"]
        }
      }
    });

    const result = JSON.parse(response.text || '{}');
    return {
      matched: result.matched ?? false,
      score: result.score ?? 0,
      feedback: result.feedback ?? "Keep trying!"
    };
  } catch (error) {
    console.error("Gemini Evaluation Error:", error);
    return { matched: false, score: 0, feedback: "Error evaluating pose." };
  }
}
