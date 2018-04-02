using System;
using UnityEngine;

namespace Assets.Src.Graph
{
    public class GraphPoint
    {
        public float X;
        public float Y;

        public GraphPoint(float x, float y)
        {
            X = x;
            Y = y;
        }

        public Vector2 ToUiPoint(ScaleBounds scale, Rect location)
        {
            var xScaleRange = scale.MaxX - scale.MinX;
            var proportionAlongXScale = xScaleRange > 0 ? ((X - scale.MinX) / xScaleRange) : 0.5f;
            var uiWidth = location.max.x - location.min.x;
            var uiX = (proportionAlongXScale * uiWidth) + location.min.x;
            
            var yScaleRange = scale.MaxY - scale.MinY;
            var proportionAlongYScale = yScaleRange > 0 ? ((Y - scale.MinY) / yScaleRange) : 0.5f;
            var uiHeight = location.min.y - location.max.y;
            var uiY = (proportionAlongYScale * uiHeight) + location.max.y;

            return new Vector2(uiX, uiY);
        }

        internal void DrawPoint(ScaleBounds scale, Rect location, Texture pointTexture, float pointSize, Color colour)
        {
            var uiPoint = ToUiPoint(scale, location);
            var rect = new Rect(uiPoint, Vector2.one * pointSize);
            GUI.DrawTexture(rect, pointTexture, ScaleMode.StretchToFill, true, 0.5f, colour, 0, 0);
        }
    }
}
