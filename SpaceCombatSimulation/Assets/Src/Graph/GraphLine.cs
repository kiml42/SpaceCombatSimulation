using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Graph
{
    public class GraphLine : I2DBounded
    {
        public string Name;
        public List<GraphPoint> Points = new List<GraphPoint>();
        public Color Colour = Random.ColorHSV();
        private readonly Texture _pointTexture;
        private readonly float _pointSize;

        public GraphLine(Texture pointTexture, float pointSize = 10)
        {
            _pointTexture = pointTexture;
            _pointSize = pointSize;
        }

        public void Add(GraphPoint point)
        {
            Points.Add(point);
        }

        public void Add(float x, float y)
        {
            Points.Add(new GraphPoint(x,y));
        }

        public Bounds2D Get2DBounds()
        {
            if (Points.Any())
            {
                return new Bounds2D(
                    Points.Min(p => p.X),
                    Points.Min(p => p.Y),
                    Points.Max(p => p.X),
                    Points.Max(p => p.Y)
                    );
            }
            return Bounds2D.Default;
        }

        internal void DrawPoints(Bounds2D scale, Rect location)
        {
            foreach(var point in Points)
            {
                point.DrawPoint(scale, location, _pointTexture, _pointSize, Colour);
            }
        }
    }
}
