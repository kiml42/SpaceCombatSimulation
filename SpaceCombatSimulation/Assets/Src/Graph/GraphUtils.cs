using UnityEngine;

namespace Assets.Src.Graph
{
    public static class GraphUtils
    {
        public static void DrawLineBetweenPoints(Vector2 p0, Vector2 p1, Texture lineTexture, Color colour, float height = 6, float extraLength = 0)
        {
            //source: https://forum.unity.com/threads/draw-a-gui-line-between-two-points.227837/
            // Draw a thin, rotated box around the line between the given points.
            // Our approach is to rotate the GUI transformation matrix around the center
            // of the line, and then draw an unrotated (horizontal) box at that point.
            float width = (p1 - p0).magnitude + extraLength;
            Vector2 center = (p0 + p1) * 0.5f;
            Rect horizontalRect = new Rect(center.x - width / 2, center.y - height / 2, width, height);
            float angle = Mathf.Atan2(p1.y - p0.y, p1.x - p0.x) * Mathf.Rad2Deg;

            Matrix4x4 savedMatrix = GUI.matrix;
            Vector3 centerScreen = GUIUtility.GUIToScreenPoint(center);
            GUI.matrix =
                Matrix4x4.TRS(centerScreen, Quaternion.identity, Vector3.one)
                    * Matrix4x4.TRS(Vector3.zero, Quaternion.Euler(0, 0, angle), Vector3.one)
                    * Matrix4x4.TRS(-centerScreen, Quaternion.identity, Vector3.one)
                    * GUI.matrix;

            GUI.DrawTexture(horizontalRect, lineTexture, ScaleMode.StretchToFill, true, 0.5f, colour, 0, 0);

            //GUI.Box(horizontalRect, "");
            GUI.matrix = savedMatrix;
        }
    }
}
