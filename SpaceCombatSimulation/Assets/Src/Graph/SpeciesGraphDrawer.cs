using System.Collections.Generic;
using System.Linq;

namespace Assets.Src.Graph
{
    public class SpeciesGraphDrawer : BaseGraphDrawer
    {
        internal override void PrepareGraph()
        {
            var generations = Enumerable.Range(0, EvolutionControler.GenerationNumber)
                .ToDictionary(i => i, i => EvolutionControler.DbHandler.ReadBaseGeneration(EvolutionControler.DatabaseId, i).Summaries);

            var speciesOverGens = new Dictionary<int, IDictionary<string,int>>();
            //var subspeciesOverGens = new Dictionary<int, IDictionary<string,int>>();

            var speciesLines = new Dictionary<string, GraphLine>();

            foreach(var kv in generations)
            {
                var summeries = kv.Value;

                var species = summeries.GroupBy(s => s.Species).OrderByDescending(grp => grp.Count()).ToDictionary(grp => grp.Key, grp => grp.Count());
                //var subspecies = summeries.GroupBy(s => s.Subspecies).ToDictionary(grp => grp.Key, grp => grp.Count());

                speciesOverGens[kv.Key] = species;
                //subspeciesOverGens[kv.Key] = subspecies;


                foreach (var speciesCount in species)
                {
                    GraphLine line = speciesLines.ContainsKey(speciesCount.Key) ? speciesLines[speciesCount.Key] : new GraphLine();

                    line.Name = speciesCount.Key;
                    line.Add(kv.Key, speciesCount.Value);

                    speciesLines[speciesCount.Key] = line;

                    //Debug.Log(
                    //    "G:" + kv.Key.ToString().PadRight(4) +
                    //    "spec: " + speciesCount.Key.PadRight(30) +
                    //    "count:" + speciesCount.Value
                    //    );
                }
                //Debug.Log("--------");
            }

            _graph = new LineGraph(speciesLines.Values.ToArray());
        }
    }
}
