using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Graph
{
    public class LineGraph : I2DBounded, IGraph
    {
        public List<GraphLine> Lines;

        public LineGraph(params GraphLine[] lines)
        {
            Lines = lines.ToList();
        }

        public void DrawGraph(Rect location, Texture boarderTexture, Texture pointTexture)
        {
            GUI.DrawTexture(location, boarderTexture, ScaleMode.StretchToFill, true, 0.5f, Color.white, 5, 5);

            var scale = Get2DBounds();

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

        public Bounds2D Get2DBounds()
        {
            if (Lines.Any())
            {
                return new Bounds2D(
                    Lines.Min(l => l.Get2DBounds().MinX),
                    Lines.Min(l => l.Get2DBounds().MinY),
                    Lines.Max(l => l.Get2DBounds().MaxX),
                    Lines.Max(l => l.Get2DBounds().MaxY)
                    );
            }
            return Bounds2D.Default;
        }
    }
}
