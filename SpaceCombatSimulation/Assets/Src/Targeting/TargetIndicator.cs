using Assets.Src.Interfaces;
using UnityEngine;

public class TargetIndicator : MonoBehaviour
{
    public LineRenderer TargetingLine;
    public IKnowsCurrentTarget TargetKnower;

    // Use this for initialization
    void Start ()
    {
        if (TargetKnower == null)
        {
            TargetKnower = TargetKnower ?? GetComponentInParent<IKnowsCurrentTarget>();
        }
        if (TargetingLine == null)
        {
            TargetingLine = TargetingLine ?? GetComponent<LineRenderer>();
        }
    }
	
	// Update is called once per frame
	void Update () {
        if(TargetingLine != null)
        {
            TargetingLine.SetPosition(0, transform.position);
            TargetingLine.SetPosition(1, TargetKnower.CurrentTarget.Transform.position);
        }
    }
}
