using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Evolution
{
    public class MutationConfig
    {
        public int Id;

        public int Mutations = 3;

        public string AllowedCharacters = " 0123456789  ";

        public int MaxMutationLength = 5;

        public int GenomeLength = 50;

        public int GenerationSize = 20;

        public bool UseCompletelyRandomDefaultGenome = false;

        public string DefaultGenome = "";
    }
}
