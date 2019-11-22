using Assets.Src.Interfaces;
using UnityEngine;

public class TargetIndicator : MonoBehaviour
{
    public Transform SourceObject;
    public LineRenderer TargetingLine;
    public IKnowsCurrentTarget TargetKnower;

    // Use this for initialization
    void Start ()
    {
        TargetKnower = TargetKnower ?? GetComponentInParent<IKnowsCurrentTarget>();
        TargetingLine = TargetingLine ?? GetComponent<LineRenderer>();
        SourceObject = SourceObject ?? transform.parent ?? transform;
    }
	
	// Update is called once per frame
	void Update () {
        if(SourceObject != null && TargetKnower != null && TargetKnower.CurrentTarget?.Transform != null )
        {
            TargetingLine.SetPosition(0, SourceObject.transform.position);
            TargetingLine.SetPosition(1, TargetKnower.CurrentTarget.Transform.position);
            TargetingLine.enabled = true;
        } else
        {
            TargetingLine.enabled = false;
        }
    }
}
