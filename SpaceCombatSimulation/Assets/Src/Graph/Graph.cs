using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Graph
{
    public class LineGraph : IScalableGraph
    {
        public List<GraphLine> Lines;

        public LineGraph(params GraphLine[] lines)
        {
            Lines = lines.ToList();
        }

        public void DrawGraph(Rect location, Texture boarderTexture, Texture pointTexture)
        {
            GUI.DrawTexture(location, boarderTexture, ScaleMode.StretchToFill, true, 0.5f, Color.white, 5, 5);

            var scale = GetScale();

            foreach( var line in Lines)
            {
                line.DrawPoints(scale, location, pointTexture);
            }

            var zeroZeroUiPoint = new GraphPoint(0, 0).ToUiPoint(scale, location);
            GUI.Label(new Rect(zeroZeroUiPoint.x, zeroZeroUiPoint.y, 40, 40), "0");

            if (Lines.Any())
            {
                var line = Lines.First();
                foreach (var point in line.Points)
                {
                    var uiPoint = point.ToUiPoint(scale, location);

                    GUI.Label(new Rect(uiPoint.x, location.max.y, 40, 40), point.X.ToString());
                }
            }
        }

        public ScaleBounds GetScale()
        {
            return new ScaleBounds(
                Lines.Min(l => l.GetScale().MinX),
                Lines.Min(l => l.GetScale().MinY),
                Lines.Max(l => l.GetScale().MaxX),
                Lines.Max(l => l.GetScale().MaxY)
                );
        }
    }
}
